/*---------------------------------------------------------------------------------------------
 *  Copyright (c) EXL, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

var exlcode = require("exlcode/lib/exlcode");
import { Repository, TreeItem, Error as ExlcodeError } from "exlcode";
import { TPromise } from "vs/base/common/winjs.base";
import { IExlcodeService } from "exlcode/exlcodeService";
import { Limiter } from "vs/base/common/async";
import paths = require("vs/base/common/paths");

const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;
const S_IFREG = 0x8000;
const S_IFDIR = 0x4000;

export interface IExlcodeTreeStat {
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
	mode: number;
	size: number;
	sha: string;
	submodule_git_url?: string;
}

class DirEntry implements IExlcodeTreeStat {
	realpath: string;
	children: { [name: string]: DirEntry };
	submodule_git_url: string;

	constructor(
		public name: string,
		public mode: number,
		public size: number,
		public sha: string
	) {}

	public isDirectory(): boolean {
		return (this.mode & S_IFMT) === S_IFDIR;
	}

	public isSymbolicLink(): boolean {
		return (this.mode & S_IFMT) === S_IFLNK;
	}
}

export interface IExlcodeTreeCache {
	markDirty(): void;
	getFakeMtime(): number;
	stat(
		path: string,
		cb: (error: any, result?: IExlcodeTreeStat) => void
	): void;
	lstat(
		path: string,
		cb: (error: any, result?: IExlcodeTreeStat) => void
	): void;
	realpath(path: string, cb: (error: any, result?: string) => void): void;
	readdir(
		path: string,
		callback: (error: any, files?: string[]) => void
	): void;
}

export class ExlcodeTreeCache implements IExlcodeTreeCache {
	private tree: DirEntry;
	private dirty: boolean;
	private fakeMtime: number;

	constructor(
		private exlcodeService: IExlcodeService,
		private supportSymlinks: boolean
	) {
		this.markDirty();
		this.fakeMtime = new Date().getTime();
	}

	public markDirty() {
		this.dirty = true;
	}

	public getFakeMtime(): number {
		return this.fakeMtime;
	}

	private findEntry(path: string, useSymlinks: boolean): DirEntry {
		// The path must begin with '/'
		let parts = paths.normalize(path, false).split("/");
		if (parts[0] !== "") return null;

		// Resolve each successive path component
		let entry: DirEntry = this.tree;
		for (let i = 1; i < parts.length; i++) {
			// Ignore trailing slash
			if (i === parts.length - 1 && parts[i] === "") break;

			// Make sure this entry is a directory and it has children
			if ((entry.mode & S_IFMT) !== S_IFDIR || !entry.children)
				return null;

			// Get the child entry
			entry = entry.children[parts[i]];

			// Follow symlinks
			if (this.supportSymlinks) {
				if (i !== parts.length - 1 || useSymlinks) {
					while (entry && (entry.mode & S_IFMT) === S_IFLNK) {
						if (!entry.realpath) return null;
						entry = this.findEntry(entry.realpath, true);
					}
				}
			}
			if (!entry) return null;
		}
		return entry;
	}

	private updateTreeWorker(items: TreeItem[]): TPromise<void> {
		// Limit to one query at a time to not flood exlcode api
		let limiter = new Limiter(1);
		let promises: TPromise<void>[] = [];

		// Rebuild the tree
		this.tree = new DirEntry("", S_IFDIR, 0, "");
		items.forEach((item: TreeItem) => {
			// Add the entry
			let entry = new DirEntry(
				paths.basename(item.path),
				parseInt(item.mode, 8),
				item.size || 0,
				item.sha
			);
			let dir = paths.dirname("/" + item.path);
			let parent: DirEntry = this.findEntry(dir, false);
			if (!parent.children) parent.children = {};
			parent.children[entry.name] = entry;

			// If it's a type 'commit' it may be a git submodule in which case we need the gitsubmodule_url.
			if (item.type === "commit") {
				promises.push(
					limiter.queue(
						() =>
							new TPromise<void>((c, e) => {
								this.exlcodeService.repo.contents(
									this.exlcodeService.ref,
									item.path,
									(err: ExlcodeError, contents?: any) => {
										if (err) {
											console.log(
												"repo.contents api failed " +
													item.path
											);
											e(null);
										} else {
											if (contents.submodule_git_url) {
												entry.submodule_git_url =
													contents.submodule_git_url;
											}
											c(null);
										}
									}
								);
							})
					)
				);
			}

			// If it is a symlink, the symlink's realpath needs to be retrieved
			if (this.supportSymlinks && entry.isSymbolicLink()) {
				entry.realpath = null;
				promises.push(
					limiter.queue(
						() =>
							new TPromise<void>((c, e) => {
								this.exlcodeService.repo.getBlob(
									item.sha,
									(err: ExlcodeError, path: string) => {
										if (err) {
											e(null);
										} else {
											// exlcode.js relies on axios, which returns numbers for results
											// that can be parsed as numbers. Make sure the path is
											// converted to a string.
											entry.realpath = paths.makePosixAbsolute(
												paths.join(dir, "" + path)
											);
											c(null);
										}
									}
								);
							})
					)
				);
			}
		});

		// Wait for the symlink resolution to finish
		return TPromise.join(promises).then(() => {
			return;
		});
	}

	private refresh(): TPromise<void> {
		return new TPromise<void>((c, e) => {
			if (!this.dirty) return c(null);
			let kind = this.exlcodeService.isTag ? "tags/" : "heads/";
			this.exlcodeService.repo.getRef(
				kind + this.exlcodeService.ref,
				(err: ExlcodeError, sha: string) => {
					if (err) return e(null);
					this.exlcodeService.repo.getTreeRecursive(
						sha,
						(err: ExlcodeError, items: TreeItem[]) => {
							if (err) return e(null);
							this.updateTreeWorker(items).then(
								() => {
									this.dirty = false;
									return c(null);
								},
								() => e(null)
							);
						}
					);
				}
			);
		});
	}

	public stat(
		path: string,
		cb: (error: any, result?: IExlcodeTreeStat) => void
	): void {
		// stat follows symlinks
		this.refresh().then(
			() => {
				let entry = this.findEntry(path, true);
				if (!entry) return cb({ code: "ENOENT" });
				return cb(null, entry);
			},
			() => {
				return cb({ code: "EINTR" });
			}
		);
	}

	public lstat(
		path: string,
		cb: (error: any, result?: IExlcodeTreeStat) => void
	): void {
		// lstat does not follow symlinks
		this.refresh().then(
			() => {
				let entry = this.findEntry(path, false);
				if (!entry) return cb({ code: "ENOENT" });
				return cb(null, entry);
			},
			() => {
				return cb({ code: "EINTR" });
			}
		);
	}

	public realpath(
		path: string,
		cb: (error: any, result?: string) => void
	): void {
		this.refresh().then(
			() => {
				let entry = this.findEntry(path, false);
				if (!entry) return cb({ code: "ENOENT" });

				if ((entry.mode & S_IFMT) === S_IFLNK) {
					if (entry.realpath) return cb(null, entry.realpath);
				}
				return cb(null, path);
			},
			() => {
				return cb({ code: "EINTR" });
			}
		);
	}

	public readdir(
		path: string,
		cb: (error: any, files?: string[]) => void
	): void {
		this.refresh().then(
			() => {
				let entry = this.findEntry(path, true);
				if (!entry) {
					return cb({ code: "ENOENT" });
				}

				if ((entry.mode & S_IFMT) !== S_IFDIR) {
					cb({ code: "ENOTDIR" });
					return;
				}

				if (!entry.children) {
					cb(null, []);
					return;
				}

				cb(null, Object.keys(entry.children));
			},
			() => {
				return cb({ code: "EINTR" });
			}
		);
	}
}
