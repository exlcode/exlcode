/*---------------------------------------------------------------------------------------------
 *  Copyright (c) EXL, Inc. All rights reserved.
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

import { TPromise } from "vs/base/common/winjs.base";
import {
	WorkbenchShell,
	enableBrowserHack,
	BrowserHack
} from "vs/workbench/electron-browser/shell";
import { IOptions } from "vs/workbench/common/options";
import { domContentLoaded } from "vs/base/browser/dom";
import errors = require("vs/base/common/errors");
import platform = require("vs/base/common/platform");
import paths = require("vs/base/common/paths");
import timer = require("vs/base/common/timer");
import { assign } from "vs/base/common/objects";
import uri from "vs/base/common/uri";
import strings = require("vs/base/common/strings");
import { IResourceInput } from "vs/platform/editor/common/editor";
import { EventService } from "vs/platform/event/common/eventService";
import { LegacyWorkspaceContextService } from "vs/workbench/services/workspace/common/contextService";
import { IWorkspace } from "vs/platform/workspace/common/workspace";
import { WorkspaceConfigurationService } from "vs/workbench/services/configuration/node/configurationService";
import { Exlcode, Repository, Error as ExlcodeError, UserInfo } from "exlcode";
import { ExlcodeService, IExlcodeService } from "exlcode/exlcodeService";
import { IProcessEnvironment } from "vs/code/electron-main/env";
import { ParsedArgs } from "vs/code/node/argv";
// DESKTOP: import {realpath} from 'vs/base/node/pfs';
// DESKTOP: import {EnvironmentService} from 'vs/platform/environment/node/environmentService';
import { IEnvironmentService } from "vs/platform/environment/common/environment";
// DESKTOP: import {IEnvService} from 'vs/code/electron-main/env';
// DESKTOP: import {IProductConfiguration} from 'vs/platform/product';
// DESKTOP: import path = require('path');
var path = {
	normalize: function(_path) {
		console.log("path.normalize('" + _path + "')");
		return _path;
	},
	basename: function(_path) {
		console.log("path.basename('" + _path + "')");
		return _path;
	}
};

// TODO: import fs = require('fs');
var fs = {
	realpathSync: function(_path) {
		console.log("fs.realpathSync('" + _path + "')");
		return _path;
	}
};
// DESKTOP: import gracefulFs = require('graceful-fs');

// DESKTOP: gracefulFs.gracefulify(fs); // enable gracefulFs

const timers = (<any>window).MonacoEnvironment.timers;

export interface IPath {
	filePath: string;
	lineNumber?: number;
	columnNumber?: number;
}

// TODO: Perhaps move these into IEnvironment? Then accessing them would be easier from IConfiguration.
export interface IWindowConfiguration extends ParsedArgs {
	appRoot: string;
	execPath: string;

	userEnv: IProcessEnvironment;

	workspacePath?: string;

	filesToOpen?: IPath[];
	filesToCreate?: IPath[];
	filesToDiff?: IPath[];

	extensionsToInstall?: string[];
	exlcode?: Exlcode;
	exlcodeRepo?: string;
	exlcodeBranch?: string;
	exlcodeContext?: string;
	exlcodeTag?: string;
	gistRegEx?: RegExp;
	rootPath?: string;
	buildType?: string;
	readOnly?: boolean;
}

class EnvironmentService implements IEnvironmentService {
	// IEnvironmentService implementation

	_serviceBrand = null;

	execPath = "";
	appRoot = "";

	userHome = "";
	userDataPath = "";

	appSettingsHome = "";
	appSettingsPath = "";
	appKeybindingsPath = "";

	disableExtensions = true;
	extensionsPath = "";
	extensionDevelopmentPath = "";
	extensionTestsPath = "";

	debugExtensionHost = { port: 0, break: false };

	logExtensionHostCommunication = false;

	isBuilt = false;
	verbose = false;
	performance = false;

	mainIPCHandle = "";
	sharedIPCHandle = "";

	// IEnvService implementation (overlaps with IEnvironmentService)

	cliArgs = null;
	product = {
		nameShort: "EXLcode",
		nameLong: "EXLcode",
		applicationName: "applicationName",
		win32AppUserModelId: "win32AppUserModelId",
		win32MutexName: "win32MutexName",
		darwinBundleIdentifier: "darwinBundleIdentifier",
		urlProtocol: "urlProtocol",
		dataFolderName: "dataFolderName",
		downloadUrl: "downloadUrl",
		// updateUrl?: string;
		// quality?: string;
		commit: "commit",
		date: "date",
		extensionsGallery: {
			serviceUrl: "extensionsGallery.surviceUrl",
			itemUrl: "extensionsGallery.itemUrl"
		},
		extensionTips: null,
		extensionImportantTips: null,
		crashReporter: null,
		welcomePage: "welcomePage",
		enableTelemetry: false,
		aiConfig: {
			key: "aiConfig.key",
			asimovKey: "aiConfig.asmiovKey"
		},
		sendASmile: {
			reportIssueUrl: "sendASmile.reportIssueUrl",
			requestFeatureUrl: "sendASmile.requestFeatureUrl"
		},
		documentationUrl: "https://exlcode.com/documentation",
		releaseNotesUrl: "https://exlcode.com/release-notes",
		twitterUrl: null,
		requestFeatureUrl: "https://github.com/exlcode/exlcode/labels/feedback",
		reportIssueUrl:
			"https://github.com/exlcode/exlcode/issues?q=is%3Aissue%20is%3Aopen%20-label%3Afeedback",
		licenseUrl:
			"https://github.com/exlcode/exlcode/blob/master/LICENSE.txt",
		privacyStatementUrl: null,
		npsSurveyUrl: null,

		// EXLcode fields

		sendFeedbackUrl:
			"https://github.com/exlcode/exlcode/issues/new?labels=feedback"
	};
	updateUrl = "";
	quality = "";
	currentWorkingDirectory = "";
	appHome = "";

	constructor(environment: IWindowConfiguration) {
		assign(this, environment);
	}
}

export function startup(configuration: IWindowConfiguration): TPromise<void> {
	// Shell Options
	const filesToOpen =
		configuration.filesToOpen && configuration.filesToOpen.length
			? toInputs(configuration.filesToOpen)
			: null;
	const filesToCreate =
		configuration.filesToCreate && configuration.filesToCreate.length
			? toInputs(configuration.filesToCreate)
			: null;
	const filesToDiff =
		configuration.filesToDiff && configuration.filesToDiff.length
			? toInputs(configuration.filesToDiff)
			: null;
	const shellOptions: IOptions = {
		filesToOpen,
		filesToCreate,
		filesToDiff,
		extensionsToInstall: configuration.extensionsToInstall
	};

	if (configuration.performance) {
		timer.ENABLE_TIMER = true;
	}

	var options = {};
	if (configuration.userEnv["githubToken"]) {
		options["token"] = configuration.userEnv["githubToken"];
	} else if (
		configuration.userEnv["githubUsername"] &&
		configuration.userEnv["githubPassword"]
	) {
		options["username"] = configuration.userEnv["githubUsername"];
		options["password"] = configuration.userEnv["githubPassword"];
	}
	let exlcodeService = new ExlcodeService(options);

	// TODO: indeterminate progress indicator
	return exlcodeService.authenticateUser().then(
		(userInfo: UserInfo) => {
			if (!configuration.exlcodeRepo)
				// Open workbench without a workspace.
				return openWorkbench(
					configuration,
					null,
					shellOptions,
					exlcodeService
				);

			return exlcodeService
				.openRepository(
					configuration.exlcodeRepo,
					configuration.exlcodeBranch
						? configuration.exlcodeBranch
						: configuration.exlcodeTag,
					configuration.exlcodeContext,
					!configuration.exlcodeBranch
				)
				.then((repoInfo: any) => {
					// Tags aren't editable.
					if (!configuration.exlcodeBranch)
						configuration.readOnly = true;
					return getWorkspace(configuration, repoInfo).then(
						workspace => {
							return openWorkbench(
								configuration,
								workspace,
								shellOptions,
								exlcodeService
							);
						},
						(err: Error) => {
							// TODO: Welcome experience and/or error message (invalid repo, permissions, ...)
							// Open workbench without a workspace.
							return openWorkbench(
								configuration,
								null,
								shellOptions,
								exlcodeService
							);
						}
					);
				});
		},
		(err: Error) => {
			// No user credentials or otherwise unable to authenticate them.
			// TODO: Welcome experience and/or error message (bad credentials, ...)
			// Open workbench without a workspace.
			if (!configuration.exlcodeRepo) {
				return openWorkbench(
					configuration,
					null,
					shellOptions,
					exlcodeService
				);
			}
			return exlcodeService
				.openRepository(
					configuration.exlcodeRepo,
					configuration.exlcodeBranch
						? configuration.exlcodeBranch
						: configuration.exlcodeTag,
					configuration.exlcodeContext,
					!configuration.exlcodeBranch
				)
				.then((repoInfo: any) => {
					// Tags aren't editable.
					if (!configuration.exlcodeBranch)
						configuration.readOnly = true;
					return getWorkspace(configuration, repoInfo).then(
						workspace => {
							return openWorkbench(
								configuration,
								workspace,
								shellOptions,
								exlcodeService
							);
						},
						(err: Error) => {
							// TODO: Welcome experience and/or error message (invalid repo, permissions, ...)
							// Open workbench without a workspace.
							return openWorkbench(
								configuration,
								null,
								shellOptions,
								exlcodeService
							);
						}
					);
				});
		}
	);
}

function toInputs(paths: IPath[]): IResourceInput[] {
	return paths.map(p => {
		const input = <IResourceInput>{
			resource: uri.file(p.filePath)
		};

		if (p.lineNumber) {
			input.options = {
				selection: {
					startLineNumber: p.lineNumber,
					startColumn: p.columnNumber
				}
			};
		}

		return input;
	});
}

function getWorkspace(
	configuration: IWindowConfiguration,
	repoInfo: any
): TPromise<IWorkspace> {
	if (!configuration.workspacePath) {
		return TPromise.as(null);
	}

	let workspaceResource = uri.file(configuration.workspacePath);

	let workspace: IWorkspace = {
		resource: workspaceResource,
		name: configuration.exlcodeRepo.split("/")[1], // Repository name minus the user name.
		uid: Date.parse(repoInfo.created_at)
	};
	return TPromise.as(workspace);
}

function openWorkbench(
	environment: IWindowConfiguration,
	workspace: IWorkspace,
	options: IOptions,
	exlcodeService: IExlcodeService
): TPromise<void> {
	const eventService = new EventService();
	// DESKTOP:	const environmentService = new EnvironmentService(environment, environment.execPath);
	const environmentService = new EnvironmentService(environment);
	const contextService = new LegacyWorkspaceContextService(
		workspace,
		options
	);
	const configurationService = new WorkspaceConfigurationService(
		contextService,
		eventService,
		environmentService,
		exlcodeService
	);

	// Since the configuration service is one of the core services that is used in so many places, we initialize it
	// right before startup of the workbench shell to have its data ready for consumers
	return configurationService.initialize().then(() => {
		timers.beforeReady = new Date();

		return domContentLoaded().then(() => {
			timers.afterReady = new Date();

			// Enable browser specific hacks
			enableBrowserHack(BrowserHack.EDITOR_MOUSE_CLICKS);
			enableBrowserHack(BrowserHack.MESSAGE_BOX_TEXT);
			enableBrowserHack(BrowserHack.TAB_LABEL);

			// Open Shell
			const beforeOpen = new Date();
			const shell = new WorkbenchShell(
				document.body,
				workspace,
				{
					configurationService,
					eventService,
					contextService,
					environmentService,
					exlcodeService
				},
				options
			);
			shell.open();

			shell.joinCreation().then(() => {
				timer
					.start(
						timer.Topic.STARTUP,
						"Open Shell, Viewlet & Editor",
						beforeOpen,
						"Workbench has opened after this event with viewlet and editor restored"
					)
					.stop();
			});

			// Inform user about loading issues from the loader
			(<any>self).require.config({
				onError: (err: any) => {
					if (err.errorCode === "load") {
						shell.onUnexpectedError(errors.loaderError(err));
					}
				}
			});
		});
	});
}
