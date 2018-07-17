/*---------------------------------------------------------------------------------------------
 *  Copyright (c) EXL, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

var exlcode = require("exlcode/lib/exlcode");
import {
	User,
	Gist,
	Exlcode,
	Repository,
	UserInfo,
	Error as ExlcodeError
} from "exlcode";
import {
	createDecorator,
	ServiceIdentifier
} from "vs/platform/instantiation/common/instantiation";
import { TPromise } from "vs/base/common/winjs.base";
import { ExlcodeTreeCache, IExlcodeTreeCache } from "exlcode/exlcodeTreeCache";
import { IWindowConfiguration } from "vs/workbench/electron-browser/main";
import uri from "vs/base/common/uri";
import { IFileStat, FileOperationResult } from "vs/platform/files/common/files";
import paths = require("vs/base/common/paths");

const RECENT_REPOS_COUNT = 4;

export interface GistInfo {
	gist: Gist;
	fileExists: boolean;
}

export var IExlcodeService = createDecorator<IExlcodeService>("exlcodeService");

export interface IExlcodeService {
	_serviceBrand: any;

	exlcode: Exlcode;
	repo: Repository;
	repoName: string;
	ref: string;
	isTag: boolean;

	isFork(): boolean;
	isDefaultBranch(): boolean;
	getDefaultBranch(): string;
	getCache(): IExlcodeTreeCache;
	hasCredentials(): boolean;
	isAuthenticated(): boolean;
	authenticateUser(): TPromise<UserInfo>;
	getAuthenticatedUserInfo(): UserInfo;
	authenticate(privateRepos: boolean);
	openRepository(
		repo: string,
		ref?: string,
		context?: string,
		isTag?: boolean
	): TPromise<any>;
	getRecentRepos(): string[];
	signOut(): void;
	findGist(resource: uri): TPromise<GistInfo>;
	resolveGistFile(resource: uri): TPromise<IFileStat>;
}

export class ExlcodeService implements IExlcodeService {
	public _serviceBrand: any;

	public serviceId = IExlcodeService;
	public exlcode: Exlcode;
	public repo: Repository;
	public repoName: string;
	public ref: string;
	public isTag: boolean;

	private options: any;
	private authenticatedUserInfo: any;
	private repoInfo: any;
	private cache: ExlcodeTreeCache;

	constructor(options?: any) {
		this.options = options;
		this.exlcode = new exlcode(options);
	}

	public isFork(): boolean {
		return "parent" in this.repoInfo;
	}

	public isDefaultBranch(): boolean {
		return !this.isTag && this.ref === this.repoInfo.default_branch;
	}

	public getDefaultBranch(): string {
		return this.repoInfo.default_branch;
	}

	public getCache(): IExlcodeTreeCache {
		return this.cache;
	}

	public hasCredentials(): boolean {
		return (
			(this.options.username && this.options.password) ||
			this.options.token
		);
	}

	public isAuthenticated(): boolean {
		return !!this.authenticatedUserInfo;
	}

	public authenticateUser(): TPromise<UserInfo> {
		if (!this.hasCredentials()) {
			return TPromise.wrapError<UserInfo>(
				"authenticateUser requires user credentials"
			);
		}
		return new TPromise<UserInfo>((complete, error) => {
			this.exlcode
				.getUser()
				.show(null, (err: ExlcodeError, info?: UserInfo) => {
					if (err) {
						error(err);
					} else {
						this.authenticatedUserInfo = info;
						complete(info);
					}
				});
		});
	}

	public getAuthenticatedUserInfo(): UserInfo {
		return this.authenticatedUserInfo;
	}

	private inIframe() {
		try {
			return window.self !== window.top;
		} catch (e) {
			return true;
		}
	}

	private openAuthUrl(url: string) {
		if (this.inIframe) {
			window.top.location.href = url;
			return;
		}
		window.location.href = url;
	}

	public authenticate(privateRepos: boolean) {
		(<any>window).sendGa(
			"/requesting/" + (privateRepos ? "private" : "public"),
			() => {
				// If we're running on localhost authorize via the "EXLcode localhost" application
				// so we're redirected back to localhost (instead of exlcode.com/ide) after
				// the authorization is done.
				let client_id =
					window.location.hostname == "localhost" ||
					window.location.hostname == "127.0.0.1"
						? "851d4692c26d70b344ac"
						: "b837e595861e6139950f";
				let repoScope = privateRepos ? "repo" : "public_repo";
				this.openAuthUrl(
					"https://github.com/login/oauth/authorize?client_id=" +
						client_id +
						"&scope=" +
						repoScope +
						" gist"
				);
			}
		);
	}

	public openRepository(
		repoName: string,
		ref?: string,
		context?: string,
		isTag?: boolean
	): TPromise<any> {
		this.repoName = repoName;
		this.ref = ref;
		this.isTag = isTag;
		this.repo = this.exlcode.getRepo(this.repoName);

		return new TPromise<any>((complete, error) => {
			this.repo.show((err: ExlcodeError, info?: any) => {
				if (err) {
					error(err);
				} else {
					this.addRecentRepo(this.repoName);
					this.repoInfo = info;

					// Don't support symlinks until exlcodeFileService can load symlinked paths
					this.cache = new ExlcodeTreeCache(this, false);
					complete(info);
				}
			});
		});
	}

	private addRecentRepo(repoName: string) {
		// Add repoName first
		let recentRepos = this.getRecentRepos().filter(
			repo => repo !== repoName
		);
		recentRepos.splice(0, 0, repoName);

		// Cap the list to RECENT_REPOS_COUNT entries
		recentRepos.slice(0, RECENT_REPOS_COUNT);

		// Save it out
		try {
			let s = JSON.stringify(recentRepos);
			window.sessionStorage.setItem("exlcodeRecentRepos", s);
			window.localStorage.setItem("lastExlcodeRecentRepos", s);
		} catch (error) {
			// Safari raises Quota Exceeded exception in Private Browsing mode.
		}
	}

	public getRecentRepos(): string[] {
		// Grab the recent repos
		let recentReposJson = window.sessionStorage.getItem(
			"exlcodeRecentRepos"
		);
		if (!recentReposJson) {
			recentReposJson = window.localStorage.getItem(
				"lastExlcodeRecentRepos"
			);
		}

		try {
			let recentRepos = JSON.parse(recentReposJson);
			if (!Array.isArray(recentRepos)) return [];
			return recentRepos
				.filter(
					name =>
						typeof name === "string" && name.split("/").length === 2
				)
				.slice(0, RECENT_REPOS_COUNT);
		} catch (error) {
			return [];
		}
	}

	public signOut() {
		var d = new Date();
		d.setTime(d.getTime() - 1000);
		document.cookie = "githubToken=;expires=" + d.toUTCString();
		window.localStorage.removeItem("githubToken");
		window.localStorage.removeItem("githubUser");
		window.localStorage.removeItem("githubPassword");
		window.localStorage.removeItem("lastExlcodeRepo");
		window.localStorage.removeItem("lastExlcodeRecentRepos");
		window.localStorage.removeItem("lastExlcodeBranch");
		window.localStorage.removeItem("lastExlcodeContext");
		window.localStorage.removeItem("lastExlcodeTag");
		window.sessionStorage.removeItem("exlcodeRepo");
		window.sessionStorage.removeItem("exlcodeRecentRepos");
		window.sessionStorage.removeItem("exlcodeBranch");
		window.sessionStorage.removeItem("exlcodeContext");
		window.sessionStorage.removeItem("exlcodeTag");

		// Refresh to the page to fully present the signed out state.
		location.href = location.origin + location.pathname;
	}

	public findGist(resource: uri): TPromise<GistInfo> {
		return new TPromise<GistInfo>((c, e) => {
			if (!this.isAuthenticated()) {
				// We don't have access to the current paths.makeAbsoluteuser's Gists.
				e({ path: resource.path, error: "not authenticated" });
				return;
			}

			let user: User = this.exlcode.getUser();
			user.gists((err: ExlcodeError, gists?: Gist[]) => {
				// Exlcode api error
				if (err) {
					console.log(
						"Error user.gists api " + resource.path + ": " + err
					);
					e(err);
					return;
				}

				// 0 = '', 1 = '$gist', 2 = description, 3 = filename
				let parts = this.toAbsolutePath(resource).split("/");

				// Find the raw url referenced by the path
				for (let i = 0; i < gists.length; i++) {
					let gist = gists[i];
					if (gist.description !== parts[2]) {
						continue;
					}
					for (let filename in gist.files) {
						if (filename === parts[3]) {
							c({ gist: gist, fileExists: true });
							return;
						}
					}
					c({ gist: gist, fileExists: false });
					return;
				}
				c({ gist: null, fileExists: false });
			});
		});
	}

	public resolveGistFile(resource: uri): TPromise<IFileStat> {
		return new TPromise<IFileStat>((c, e) => {
			this.findGist(resource).then(
				info => {
					// Gist found but if file doesn't exist, error.
					if (!info.gist || !info.fileExists) {
						e(FileOperationResult.FILE_NOT_FOUND);
						return;
					}

					// 0 = '', 1 = '$gist', 2 = description, 3 = filename
					let parts = this.toAbsolutePath(resource).split("/");

					// exlcode is not returning Access-Control-Expose-Headers: ETag, so we
					// don't have access to that header in the response. Make
					// up an ETag. ETags don't have format dependencies.
					let size = info.gist.files[parts[3]].size;
					let etag: string = info.gist.updated_at + size;
					let stat: IFileStat = {
						resource: uri.file(resource.path),
						isDirectory: false,
						hasChildren: false,
						name: parts[2],
						mtime: Date.parse(info.gist.updated_at),
						etag: etag,
						size: size,
						mime: info.gist.files[parts[3]].type
					};

					// Extra data to return to the caller, for getting content
					(<any>stat).url = info.gist.files[parts[3]].raw_url;
					c(stat);
				},
				(error: ExlcodeError) => {
					e(FileOperationResult.FILE_NOT_FOUND);
				}
			);
		});
	}

	private toAbsolutePath(arg1: uri | IFileStat): string {
		let resource: uri;
		if (arg1 instanceof uri) {
			resource = <uri>arg1;
		} else {
			resource = (<IFileStat>arg1).resource;
		}

		return paths.normalize(resource.fsPath);
	}
}

export function openRepository(
	repo: string,
	env: IWindowConfiguration,
	context?: string,
	ref?: string,
	isTag?: boolean
) {
	let url =
		window.location.origin +
		window.location.pathname +
		"?repo=" +
		repo +
		"&context=";
	if (context) {
		url += context;
	} else {
		url += "local";
	}
	if (ref) {
		url += (isTag ? "&tag=" : "&branch=") + ref;
	}
	if (env.buildType) {
		url += "&b=" + env.buildType;
	}
	window.location.href = url;
}
