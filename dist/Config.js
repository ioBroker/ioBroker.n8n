"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
// This class just simulates the Config class from oclif/core.
class Config {
    options = {};
    arch = process.arch;
    bin = '';
    channel = '';
    dirname = '';
    home = '';
    name = '';
    root = '';
    shell = '';
    valid = true;
    version = '';
    windows = process.platform === 'win32';
    constructor(options) {
        this.options = options;
    }
    static load(opts) {
        return Promise.resolve(new Config(opts));
    }
    get commands() {
        return [];
    }
    get topics() {
        return [];
    }
    load() {
        return Promise.resolve();
    }
    runHook(event, _opts, _timeout, _captureErrors) {
        if (event === 'preparse') {
            // Simulate initialization logic
            return Promise.resolve({
                failures: [],
                successes: [],
            });
        }
        return Promise.resolve();
    }
}
exports.Config = Config;
//# sourceMappingURL=Config.js.map