/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

var gulp = require('gulp');
var shell = require('gulp-shell');
var path = require('path');
var _ = require('underscore');
var buildfile = require('../../src/exlcode/buildfile');
var util = require('./lib/util');
var common = require('./gulpfile.common');

var root = path.dirname(__dirname);
var headerVersion = process.env['BUILD_SOURCEVERSION'] || util.getVersion(root);

// Build

var exlcodeEntryPoints = _.flatten([
	buildfile.entrypoint('vs/workbench/workbench.main'),
	buildfile.base,
	// buildfile.standaloneLanguages,
	// buildfile.standaloneLanguages2,
	buildfile.languages
]);

var exlcodeResources = [
	'out-build/exlcode/**/*.{svg,png}',
	// 'out-build/vs/**/*.{svg,png}',
	// '!out-build/vs/base/browser/ui/splitview/**/*',
	// '!out-build/vs/base/browser/ui/toolbar/**/*',
	// '!out-build/vs/base/browser/ui/octiconLabel/**/*',
	'out-build/vs/{base,editor,workbench}/**/*.{svg,png}',
	'out-build/vs/{base,editor,workbench}/**/*.{woff,ttf}',
	'out-build/themes/**/*',
	'out-build/icons/**/*',
	'out-build/vs/base/worker/workerMainCompatibility.html',
	'out-build/vs/base/worker/workerMain.{js,js.map}',
	'out-build/vs/base/common/worker/*.js',
	'out-build/vs/base/common/errors.js',
	// '!out-build/vs/workbench/**',
	'out-build/monaco-*/**/*',
	'out-build/vs/workbench/parts/search/**/*',
	'out-build/vs/workbench/parts/terminal/**/*',
	'!**/test/**',

	// SUPER-HACK: Do this until finding out why
	// base:buildfile entry points aren't being packed.
	'out-build/vs/base/common/**/*',
	'out-build/vs/editor/common/**/*',
];

var exlcodeOtherSources = [
	'out-build/vs/css.js',
	'out-build/vs/nls.js'
	// 'out-build/vs/text.js'
];

var BUNDLED_FILE_HEADER = [
	'/*!-----------------------------------------------------------',
	' * Copyright (c) Microsoft Corporation. All rights reserved.',
	' * Version: ' + headerVersion,
	' * Released under the MIT license',
	' * https://github.com/Microsoft/vscode/blob/master/LICENSE.txt',
	' *-----------------------------------------------------------*/',
	''
].join('\n');

function exlcodeLoaderConfig() {
	var result = common.loaderConfig();

	result.paths.lib = 'out-build/exlcode/lib';
	result.paths.exlcode = 'out-build/exlcode';
	result.paths.exlcodeService = 'out-build/exlcode/exlcodeService';
	result.paths.exlcodeActions = 'out-build/exlcode/exlcodeActions';
	result.paths.exlcodeTreeCache = 'out-build/exlcode/exlcodeTreeCache';
	result.paths.openRepoHandler = 'out-build/exlcode/openRepoHandler';
	result.paths['exlcode.contribution'] = 'out-build/exlcode/exlcode.contribution';
	result.paths.userNavbarItem = 'out-build/exlcode/userNavbarItem';
	result.paths.welcomePart = 'out-build/exlcode/welcomePart';
	result.paths.menusNavbarItem = 'out-build/exlcode/menusNavbarItem';
	result.paths.fakeElectron = 'out-build/exlcode/fakeElectron';

	// TODO: Is this what we want?
	// never ship marked in exlcode
	// result.paths['vs/base/common/marked/marked'] = 'out-build/vs/base/common/marked/marked.mock';

	result['vs/css'] = {
		inlineResources: true
	};

	// if (removeAllOSS) {
	// 	result.paths['vs/languages/lib/common/beautify-html'] = 'out-build/vs/languages/lib/common/beautify-html.mock';
	// }

	return result;
}

gulp.task('clean-optimized-exlcode', util.rimraf('out-build-opt'));
gulp.task('optimize-exlcode', ['clean-optimized-exlcode', 'compile-build'], common.optimizeTask({
	entryPoints: exlcodeEntryPoints,
	otherSources: exlcodeOtherSources,
	resources: exlcodeResources,
	loaderConfig: exlcodeLoaderConfig(),
	header: BUNDLED_FILE_HEADER,
	bundleInfo: true,
	out: 'out-build-opt'
}));
gulp.task('build-opt', ['optimize-exlcode']);

gulp.task('clean-minified-exlcode', util.rimraf('out-build-min'));
gulp.task('minify-exlcode', ['clean-minified-exlcode', 'optimize-exlcode'], common.minifyTask('out-build-opt', 'out-build-min', true));
gulp.task('build-min', ['minify-exlcode'], shell.task([
	'cp index.html out-build-min',
	'awk \'/Copyright.*Microsoft/{print " * Copyright (c) EXL, Inc. All rights reserved."}1\' out-build-min/vs/workbench/workbench.main.js > /tmp/workbench.main.js',
	'mv /tmp/workbench.main.js out-build-min/vs/workbench/workbench.main.js',
]));
// Is this below running optimize-exlcode twice?
// gulp.task('exlcode-distro', ['minify-exlcode', 'optimize-exlcode']);