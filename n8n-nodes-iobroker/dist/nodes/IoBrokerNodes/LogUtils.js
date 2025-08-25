"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLastLogFile = readLastLogFile;
const node_zlib_1 = require("node:zlib");
function readLogFile(adapter, host, fileName) {
    return new Promise((resolve, reject) => {
        if (host.startsWith('system.host.')) {
            host = host.substring('system.host.'.length);
        }
        const [, hostName, transport, ...shortFileName] = fileName.split('/');
        console.log(`Reading log file ${shortFileName.join('/')} from host ${host} (${hostName}) via ${transport}`);
        adapter.sendToHost(`system.host.${hostName}`, 'getLogFile', { filename: shortFileName.join('/'), transport }, (result) => {
            const _result = result;
            if (!_result || _result.error) {
                if (_result.error) {
                    adapter.log.warn(`Cannot read log file ${fileName}: ${_result.error}`);
                }
                reject(new Error(_result.error));
            }
            else {
                if (_result.gz && _result.data) {
                    try {
                        resolve((0, node_zlib_1.gunzipSync)(_result.data).toString('utf8'));
                    }
                    catch {
                        reject(new Error(`Cannot unzip log file ${fileName}`));
                    }
                }
                else if (_result.data === undefined || _result.data === null) {
                    reject(new Error(`Cannot read log file ${fileName}: empty result`));
                }
                else {
                    resolve(_result.data.toString());
                }
            }
        });
    });
}
function getLogFiles(adapter, host) {
    return new Promise((resolve, reject) => {
        if (host.startsWith('system.host.')) {
            host = host.substring('system.host.'.length);
        }
        let timeout = setTimeout(() => {
            timeout = null;
            reject(new Error('timeout'));
        }, 30000);
        adapter.sendToHost(host, 'getLogFiles', null, (result) => {
            const answer = result;
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            if (!answer) {
                reject(new Error('no response'));
                return;
            }
            if (answer.error) {
                reject(new Error(answer.error));
                return;
            }
            if (!answer.list) {
                reject(new Error('no list'));
                return;
            }
            resolve(answer.list.filter((file) => file.fileName && !file.fileName.endsWith('ReadMe.log') && file.size > 0));
        });
    });
}
async function readLastLogFile(adapter, level, instance, count) {
    var _a;
    const instanceObj = await adapter.getForeignObjectAsync(`system.adapter.${adapter.namespace}`);
    if (!((_a = instanceObj === null || instanceObj === void 0 ? void 0 : instanceObj.common) === null || _a === void 0 ? void 0 : _a.host)) {
        throw new Error('Cannot find instance or host');
    }
    const host = instanceObj.common.host;
    const logFiles = await getLogFiles(adapter, host);
    if (!(logFiles === null || logFiles === void 0 ? void 0 : logFiles.length)) {
        return [];
    }
    logFiles.sort((a, b) => {
        if (a.fileName > b.fileName) {
            return -1;
        }
        if (a.fileName < b.fileName) {
            return 1;
        }
        return 0;
    });
    const logContent = await readLogFile(adapter, host, logFiles[0].fileName);
    const lines = logContent.split('\n');
    const logMessages = [];
    for (let l = lines.length - 1; l >= 0; l--) {
        const line = lines[l].trim();
        if (line) {
            const time = line.substring(0, '2025-08-23 23:37:53.529'.length);
            let rest = line.substring('2025-08-23 23:37:53.529'.length + 3).trim();
            const colon = rest.indexOf(':');
            if (colon === -1) {
                continue;
            }
            const severity = rest
                .substring(0, colon)
                .trim()
                .toLowerCase();
            rest = rest.substring(colon + 1).trim();
            const firstSpace = rest.indexOf(' ');
            if (firstSpace === -1) {
                continue;
            }
            const from = rest.substring(0, firstSpace).trim();
            rest = rest.substring(firstSpace + 1).trim();
            const ts = new Date(time).getTime();
            const msg = {
                message: rest,
                ts,
                severity,
                from,
                _id: ts,
            };
            if (level && msg.severity !== level) {
                continue;
            }
            if (instance && msg.from !== instance) {
                continue;
            }
            if (count && logMessages.length >= count) {
                break;
            }
            logMessages.push(msg);
        }
    }
    return logMessages;
}
//# sourceMappingURL=LogUtils.js.map