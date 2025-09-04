"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.N8NNodeAdapter = void 0;
exports.getAdapter = getAdapter;
const adapter_core_1 = require("@iobroker/adapter-core");
const DevicesUtils_1 = require("./DevicesUtils");
const LogUtils_1 = require("./LogUtils");
const pattern2RegEx = adapter_core_1.commonTools.pattern2RegEx;
function getText(text, language) {
    if (typeof text === 'string') {
        return text;
    }
    return text[language] || text.en || '';
}
const logLevels = ['silly', 'debug', 'info', 'warn', 'error'];
function isLogLevelEqualOrHigher(level, compareLevel) {
    return logLevels.indexOf(level) >= compareLevel;
}
class N8NNodeAdapter extends adapter_core_1.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            instance: 0,
            name: 'n8n',
            logTransporter: true,
            stateChange: (id, state) => this.onStateChange(id, state),
            objectChange: (id, obj) => this.onObjectChange(id, obj),
            fileChange: (id, fileName, size) => this.onFileChange(id, fileName, size),
            ready: () => this.main(),
        });
        this._ready = false;
        this.subscribes = {
            state: {},
            object: {},
            file: {},
        };
        this.ownLanguage = 'en';
        this.cache = {
            devices: null,
            ts: 0,
        };
        this.handlers = {
            state: {},
            file: {},
            object: {},
            log: {},
        };
        this.requests = {
            getState: [],
            setState: [],
            getObject: [],
            setObject: [],
            setFile: [],
            getFile: [],
            getLogs: [],
            writeLog: [],
            readEnums: [],
            instances: [],
            readDevices: [],
        };
        this.onLog = (message) => {
            const nodeIds = Object.keys(this.handlers.log);
            for (let i = 0; i < nodeIds.length; i++) {
                const nodeId = nodeIds[i];
                if (this.handlers.log[nodeId].instanceRx) {
                    if (this.handlers.log[nodeId].instanceRx.test(message.from)) {
                        if (!this.handlers.log[nodeId].level ||
                            isLogLevelEqualOrHigher(message.severity, this.handlers.log[nodeId].compareLevel)) {
                            this.handlers.log[nodeId].cb(message);
                        }
                    }
                }
                else if (this.handlers.log[nodeId].instance) {
                    if (this.handlers.log[nodeId].instance === message.from) {
                        if (!this.handlers.log[nodeId].level ||
                            isLogLevelEqualOrHigher(message.severity, this.handlers.log[nodeId].compareLevel)) {
                            this.handlers.log[nodeId].cb(message);
                        }
                    }
                }
                else if (!this.handlers.log[nodeId].level ||
                    isLogLevelEqualOrHigher(message.severity, this.handlers.log[nodeId].compareLevel)) {
                    this.handlers.log[nodeId].cb(message);
                }
            }
        };
        this.on('log', this.onLog);
    }
    async main() {
        var _a, _b;
        this._ready = true;
        this.log.info(`N8N Node Adapter started ${Object.keys(this.handlers.state).length}`);
        const systemObject = await this.getForeignObjectAsync('system.config');
        if ((_a = systemObject === null || systemObject === void 0 ? void 0 : systemObject.common) === null || _a === void 0 ? void 0 : _a.language) {
            this.ownLanguage = systemObject.common.language;
        }
        const states = Object.keys(this.handlers.state);
        for (let i = 0; i < states.length; i++) {
            const nodeId = states[i];
            const handler = this.handlers.state[nodeId];
            this.log.info(`Subscribing to state ${handler.oid} for node ${nodeId}`);
            this.subscribeOnState(nodeId, handler.oid);
        }
        const objects = Object.keys(this.handlers.object);
        for (let i = 0; i < objects.length; i++) {
            const nodeId = objects[i];
            const handler = this.handlers.object[nodeId];
            this.log.info(`Subscribing to object ${handler.oid} for node ${nodeId}`);
            this.subscribeOnObject(nodeId, handler.oid);
        }
        const files = Object.keys(this.handlers.file);
        for (let i = 0; i < files.length; i++) {
            const nodeId = files[i];
            const handler = this.handlers.file[nodeId];
            this.log.info(`Subscribing to file ${handler.oid} for node ${nodeId}`);
            await this.subscribeOnFile(nodeId, { oid: handler.oid, fileName: handler.fileName });
        }
        if (Object.keys(this.handlers.log).length) {
            this.log.info(`Subscribing to logs for ${Object.keys(this.handlers.log).length} nodes`);
            await ((_b = this.requireLog) === null || _b === void 0 ? void 0 : _b.call(this, true));
        }
        for (let s = 0; s < this.requests.getState.length; s++) {
            const request = this.requests.getState[s];
            try {
                const state = await this.getForeignStateAsync(request.oid);
                request.cb(null, state);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.getState = [];
        for (let s = 0; s < this.requests.setState.length; s++) {
            const request = this.requests.setState[s];
            try {
                const id = await this.setForeignStateAsync(request.oid, request.state);
                request.cb(null, id);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.setState = [];
        for (let s = 0; s < this.requests.getObject.length; s++) {
            const request = this.requests.getObject[s];
            try {
                const obj = await this.getForeignObjectAsync(request.oid);
                request.cb(null, obj);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.getObject = [];
        for (let s = 0; s < this.requests.setObject.length; s++) {
            const request = this.requests.setObject[s];
            try {
                const result = await this.setIobObject(request.oid, request.obj);
                request.cb(null, result);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.setObject = [];
        for (let s = 0; s < this.requests.getFile.length; s++) {
            const request = this.requests.getFile[s];
            try {
                const file = await this.readFileAsync(request.oid, request.fileName);
                if (request.base64 && file.file) {
                    file.file = Buffer.from(file.file).toString('base64');
                }
                request.cb(null, file);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.getFile = [];
        for (let s = 0; s < this.requests.setFile.length; s++) {
            const request = this.requests.setFile[s];
            try {
                if (request.base64 && typeof request.file === 'string') {
                    request.file = Buffer.from(request.file, 'base64');
                }
                await this.writeFileAsync(request.oid, request.fileName, request.file);
                request.cb(null);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.setFile = [];
        for (let s = 0; s < this.requests.getLogs.length; s++) {
            const request = this.requests.getLogs[s];
            try {
                request.cb(null, await (0, LogUtils_1.readLastLogFile)(this, request.level, request.instance, request.count));
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.getLogs = [];
        for (let s = 0; s < this.requests.writeLog.length; s++) {
            const request = this.requests.writeLog[s];
            try {
                if (request.level === 'info' ||
                    request.level === 'debug' ||
                    request.level === 'warn' ||
                    request.level === 'error') {
                    this.log[request.level](request.message);
                }
            }
            catch (error) {
                this.log.error(`Failed to write log: ${error}`);
            }
        }
        this.requests.writeLog = [];
        for (let s = 0; s < this.requests.readEnums.length; s++) {
            const request = this.requests.readEnums[s];
            try {
                const enums = await this._readEnums(request.type, request.language, request.withIcons);
                request.cb(null, enums);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.readEnums = [];
        for (let s = 0; s < this.requests.readDevices.length; s++) {
            const request = this.requests.readDevices[s];
            try {
                const devices = await this._readDevices(request.language);
                request.cb(null, devices);
            }
            catch (error) {
                request.cb(error);
            }
        }
        this.requests.readDevices = [];
        for (let s = 0; s < this.requests.instances.length; s++) {
            const request = this.requests.instances[s];
            try {
                const instances = await this._getInstances();
                request.cb(null, instances);
            }
            catch (error) {
                request.cb(error);
            }
        }
    }
    onStateChange(id, state) {
        const nodeIds = Object.keys(this.handlers.state);
        for (let i = 0; i < nodeIds.length; i++) {
            const nodeId = nodeIds[i];
            if (this.handlers.state[nodeId].oidRx) {
                if (this.handlers.state[nodeId].oidRx.test(id)) {
                    this.handlers.state[nodeId].cb(id, state);
                }
            }
            else if (this.handlers.state[nodeId].oid === id) {
                this.handlers.state[nodeId].cb(id, state);
            }
        }
    }
    onObjectChange(id, obj) {
        const nodeIds = Object.keys(this.handlers.object);
        for (let i = 0; i < nodeIds.length; i++) {
            const nodeId = nodeIds[i];
            if (this.handlers.object[nodeId].oidRx) {
                if (this.handlers.object[nodeId].oidRx.test(id)) {
                    this.handlers.object[nodeId].cb(id, obj);
                }
            }
            else if (this.handlers.object[nodeId].oid === id) {
                this.handlers.object[nodeId].cb(id, obj);
            }
        }
    }
    async onFileChange(id, fileName, _size) {
        const nodeIds = Object.keys(this.handlers.file);
        let file;
        for (let i = 0; i < nodeIds.length; i++) {
            const nodeId = nodeIds[i];
            if (this.handlers.file[nodeId].oidRx) {
                if (this.handlers.file[nodeId].oidRx.test(id)) {
                    if (this.handlers.file[nodeId].fileNameRx) {
                        if (this.handlers.file[nodeId].fileNameRx.test(fileName)) {
                            if (this.handlers.file[nodeId].withContent &&
                                !file &&
                                _size !== null &&
                                _size !== undefined) {
                                file = await this.readFileAsync(id, fileName);
                            }
                            this.handlers.file[nodeId].cb(id, fileName, _size, file);
                        }
                    }
                    else if (!this.handlers.file[nodeId].fileName ||
                        this.handlers.file[nodeId].fileName === fileName) {
                        if (this.handlers.file[nodeId].withContent &&
                            !file &&
                            _size !== null &&
                            _size !== undefined) {
                            file = await this.readFileAsync(id, fileName);
                        }
                        this.handlers.file[nodeId].cb(id, fileName, _size);
                    }
                }
            }
            else if (this.handlers.file[nodeId].oid === id) {
                if (this.handlers.file[nodeId].fileNameRx) {
                    if (this.handlers.file[nodeId].fileNameRx.test(fileName)) {
                        if (this.handlers.file[nodeId].withContent &&
                            !file &&
                            _size !== null &&
                            _size !== undefined) {
                            file = await this.readFileAsync(id, fileName);
                        }
                        this.handlers.file[nodeId].cb(id, fileName, _size);
                    }
                }
                else if (!this.handlers.file[nodeId].fileName ||
                    this.handlers.file[nodeId].fileName === fileName) {
                    if (this.handlers.file[nodeId].withContent &&
                        !file &&
                        _size !== null &&
                        _size !== undefined) {
                        file = await this.readFileAsync(id, fileName);
                    }
                    this.handlers.file[nodeId].cb(id, fileName, _size);
                }
            }
        }
    }
    subscribeOnState(nodeId, oid, oldOid) {
        if (this._ready) {
            if (oldOid && oldOid !== oid) {
                if (this.subscribes.state[oldOid]) {
                    const index = this.subscribes.state[oldOid].indexOf(nodeId);
                    if (index !== -1) {
                        this.subscribes.state[oldOid].splice(index, 1);
                    }
                    if (!this.subscribes.state[oldOid].length) {
                        delete this.subscribes.state[oldOid];
                        this.unsubscribeForeignStates(oldOid);
                    }
                }
            }
            if (oid) {
                if (!this.subscribes.state[oid]) {
                    this.subscribes.state[oid] = [];
                    this.subscribeForeignStates(oid);
                }
                if (!this.subscribes.state[oid].includes(nodeId)) {
                    this.subscribes.state[oid].push(nodeId);
                }
            }
        }
    }
    subscribeOnObject(nodeId, oid, oldOid) {
        if (this._ready) {
            if (oldOid && oldOid !== oid) {
                if (this.subscribes.object[oldOid]) {
                    const index = this.subscribes.object[oldOid].indexOf(nodeId);
                    if (index !== -1) {
                        this.subscribes.object[oldOid].splice(index, 1);
                    }
                    if (!this.subscribes.object[oldOid].length) {
                        delete this.subscribes.object[oldOid];
                        this.unsubscribeForeignObjects(oldOid);
                    }
                }
            }
            if (oid) {
                if (!this.subscribes.object[oid]) {
                    this.subscribes.object[oid] = [];
                    this.subscribeForeignObjects(oid);
                }
                if (!this.subscribes.object[oid].includes(nodeId)) {
                    this.subscribes.object[oid].push(nodeId);
                }
            }
        }
    }
    async subscribeOnFile(nodeId, pattern, oldPattern) {
        if (this._ready) {
            const newKey = pattern.oid ? `${pattern.oid}####${pattern.fileName || '*'}` : '';
            const oldKey = oldPattern ? `${oldPattern.oid}####${oldPattern.fileName || '*'}` : '';
            if (oldKey && oldKey !== newKey) {
                if (this.subscribes.file[oldKey]) {
                    const index = this.subscribes.file[oldKey].indexOf(nodeId);
                    if (index !== -1) {
                        this.subscribes.file[oldKey].splice(index, 1);
                    }
                    if (!this.subscribes.file[oldKey].length) {
                        delete this.subscribes.file[oldKey];
                        await this.unsubscribeForeignFiles(oldPattern.oid, oldPattern.fileName || '*');
                    }
                }
            }
            if (newKey) {
                if (!this.subscribes.file[newKey]) {
                    this.subscribes.file[newKey] = [];
                    console.log('Subscribing to files', pattern.oid, pattern.fileName || '*');
                    await this.subscribeForeignFiles(pattern.oid, pattern.fileName || '*');
                }
                if (!this.subscribes.file[newKey].includes(nodeId)) {
                    this.subscribes.file[newKey].push(nodeId);
                }
            }
        }
    }
    async registerHandler(handler) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
        const wasSubscribed = !!Object.keys(this.handlers.log).length;
        const stateRequest = handler;
        const objectRequest = handler;
        const fileRequest = handler;
        const logRequest = handler;
        if (stateRequest.stateHandler && stateRequest.oid) {
            if (!this.handlers.state[handler.nodeId]) {
                this.handlers.state[handler.nodeId] = {
                    oid: stateRequest.oid,
                    cb: stateRequest.stateHandler,
                };
                if (stateRequest.oid.includes('*')) {
                    try {
                        const p = pattern2RegEx(stateRequest.oid);
                        this.handlers.state[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
                    }
                    catch (e) {
                        (_a = this.log) === null || _a === void 0 ? void 0 : _a.warn(`Invalid pattern on subscribe: ${e.message}`);
                    }
                }
                this.subscribeOnState(stateRequest.nodeId, stateRequest.oid);
            }
            else {
                if (this.handlers.state[stateRequest.nodeId].oid !== stateRequest.oid) {
                    this.subscribeOnState(stateRequest.nodeId, stateRequest.oid, this.handlers.state[handler.nodeId].oid);
                    this.handlers.state[handler.nodeId].oid = stateRequest.oid;
                    if (stateRequest.oid.includes('*')) {
                        try {
                            const p = pattern2RegEx(stateRequest.oid);
                            this.handlers.state[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
                        }
                        catch (e) {
                            (_b = this.log) === null || _b === void 0 ? void 0 : _b.warn(`Invalid pattern on subscribe: ${e.message}`);
                            this.handlers.state[handler.nodeId].oidRx = undefined;
                        }
                    }
                    else {
                        this.handlers.state[handler.nodeId].oidRx = undefined;
                    }
                }
                this.handlers.state[handler.nodeId].cb = stateRequest.stateHandler;
            }
            if (this.handlers.object[handler.nodeId]) {
                this.subscribeOnObject(handler.nodeId, '', this.handlers.object[handler.nodeId].oid);
                delete this.handlers.object[handler.nodeId];
            }
            if (this.handlers.file[handler.nodeId]) {
                await this.subscribeOnFile(handler.nodeId, { oid: '', fileName: '' }, {
                    oid: this.handlers.file[handler.nodeId].oid,
                    fileName: this.handlers.file[handler.nodeId].fileName,
                });
                delete this.handlers.file[handler.nodeId];
            }
            if (this.handlers.log[handler.nodeId]) {
                delete this.handlers.log[handler.nodeId];
            }
        }
        else if (objectRequest.oid && objectRequest.objectHandler) {
            if (!this.handlers.object[handler.nodeId]) {
                this.handlers.object[handler.nodeId] = {
                    oid: objectRequest.oid,
                    cb: objectRequest.objectHandler,
                };
                if (objectRequest.oid.includes('*')) {
                    try {
                        const p = pattern2RegEx(objectRequest.oid);
                        this.handlers.object[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
                    }
                    catch (e) {
                        (_c = this.log) === null || _c === void 0 ? void 0 : _c.warn(`Invalid pattern on subscribe: ${e.message}`);
                    }
                }
                this.subscribeOnObject(handler.nodeId, objectRequest.oid);
            }
            else {
                if (this.handlers.object[handler.nodeId].oid !== objectRequest.oid) {
                    this.subscribeOnObject(objectRequest.nodeId, objectRequest.oid, this.handlers.object[objectRequest.nodeId].oid);
                    this.handlers.object[objectRequest.nodeId].oid = objectRequest.oid;
                    if (objectRequest.oid.includes('*')) {
                        try {
                            const p = pattern2RegEx(objectRequest.oid);
                            this.handlers.object[objectRequest.nodeId].oidRx = p ? new RegExp(p) : undefined;
                        }
                        catch (e) {
                            (_d = this.log) === null || _d === void 0 ? void 0 : _d.warn(`Invalid pattern on subscribe: ${e.message}`);
                            this.handlers.object[objectRequest.nodeId].oidRx = undefined;
                        }
                    }
                    else {
                        this.handlers.object[objectRequest.nodeId].oidRx = undefined;
                    }
                }
                this.handlers.object[objectRequest.nodeId].cb = objectRequest.objectHandler;
            }
            if (this.handlers.state[objectRequest.nodeId]) {
                this.subscribeOnState(objectRequest.nodeId, '', this.handlers.state[objectRequest.nodeId].oid);
                delete this.handlers.state[objectRequest.nodeId];
            }
            if (this.handlers.file[objectRequest.nodeId]) {
                await this.subscribeOnFile(handler.nodeId, { oid: '', fileName: '' }, {
                    oid: this.handlers.file[objectRequest.nodeId].oid,
                    fileName: this.handlers.file[objectRequest.nodeId].fileName,
                });
                delete this.handlers.file[objectRequest.nodeId];
            }
            if (this.handlers.log[objectRequest.nodeId]) {
                delete this.handlers.log[objectRequest.nodeId];
            }
        }
        else if (fileRequest.fileHandler && fileRequest.oid) {
            if (!this.handlers.file[handler.nodeId]) {
                this.handlers.file[handler.nodeId] = {
                    oid: fileRequest.oid,
                    fileName: fileRequest.fileName || '*',
                    cb: fileRequest.fileHandler,
                    withContent: fileRequest.withContent,
                };
                if (fileRequest.oid.includes('*')) {
                    try {
                        const p = pattern2RegEx(fileRequest.oid);
                        this.handlers.file[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
                    }
                    catch (e) {
                        (_e = this.log) === null || _e === void 0 ? void 0 : _e.warn(`Invalid pattern on subscribe: ${e.message}`);
                    }
                }
                if ((_f = fileRequest.fileName) === null || _f === void 0 ? void 0 : _f.includes('*')) {
                    try {
                        const p = pattern2RegEx(fileRequest.fileName);
                        this.handlers.file[handler.nodeId].fileNameRx = p ? new RegExp(p) : undefined;
                    }
                    catch (e) {
                        (_g = this.log) === null || _g === void 0 ? void 0 : _g.warn(`Invalid pattern on subscribe: ${e.message}`);
                    }
                }
                await this.subscribeOnFile(handler.nodeId, {
                    oid: fileRequest.oid,
                    fileName: fileRequest.fileName,
                });
            }
            else {
                if (this.handlers.file[handler.nodeId].oid !== fileRequest.oid ||
                    this.handlers.file[handler.nodeId].fileName !== fileRequest.fileName) {
                    await this.subscribeOnFile(handler.nodeId, {
                        oid: fileRequest.oid,
                        fileName: fileRequest.fileName,
                    }, {
                        oid: this.handlers.file[handler.nodeId].oid,
                        fileName: this.handlers.file[handler.nodeId].fileName,
                    });
                    this.handlers.file[handler.nodeId].oid = fileRequest.oid;
                    if (fileRequest.oid.includes('*')) {
                        try {
                            const p = pattern2RegEx(fileRequest.oid);
                            this.handlers.file[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
                        }
                        catch (e) {
                            (_h = this.log) === null || _h === void 0 ? void 0 : _h.warn(`Invalid pattern on subscribe: ${e.message}`);
                            this.handlers.file[handler.nodeId].oidRx = undefined;
                        }
                    }
                    else {
                        this.handlers.file[handler.nodeId].oidRx = undefined;
                    }
                    if ((_j = fileRequest.fileName) === null || _j === void 0 ? void 0 : _j.includes('*')) {
                        try {
                            const p = pattern2RegEx(fileRequest.fileName);
                            this.handlers.file[handler.nodeId].fileNameRx = p ? new RegExp(p) : undefined;
                        }
                        catch (e) {
                            (_k = this.log) === null || _k === void 0 ? void 0 : _k.warn(`Invalid pattern on subscribe: ${e.message}`);
                            this.handlers.file[handler.nodeId].fileNameRx = undefined;
                        }
                    }
                    else {
                        this.handlers.file[handler.nodeId].fileNameRx = undefined;
                    }
                }
                this.handlers.file[handler.nodeId].cb = fileRequest.fileHandler;
                this.handlers.file[handler.nodeId].withContent = fileRequest.withContent;
            }
            if (this.handlers.state[handler.nodeId]) {
                this.subscribeOnState(handler.nodeId, '', this.handlers.state[handler.nodeId].oid);
                delete this.handlers.state[handler.nodeId];
            }
            if (this.handlers.object[handler.nodeId]) {
                this.subscribeOnObject(handler.nodeId, '', this.handlers.object[handler.nodeId].oid);
                delete this.handlers.object[handler.nodeId];
            }
            if (this.handlers.log[handler.nodeId]) {
                delete this.handlers.log[handler.nodeId];
            }
        }
        else if (logRequest.logHandler) {
            if (!this.handlers.log[handler.nodeId]) {
                this.handlers.log[handler.nodeId] = {
                    cb: logRequest.logHandler,
                    instance: logRequest.instance,
                    level: logRequest.level,
                    compareLevel: logRequest.level ? logLevels.indexOf(logRequest.level) : undefined,
                };
                if ((_l = logRequest.instance) === null || _l === void 0 ? void 0 : _l.includes('*')) {
                    try {
                        const p = pattern2RegEx(logRequest.instance);
                        this.handlers.log[handler.nodeId].instanceRx = p ? new RegExp(p) : undefined;
                    }
                    catch (e) {
                        (_m = this.log) === null || _m === void 0 ? void 0 : _m.warn(`Invalid pattern on subscribe: ${e.message}`);
                    }
                }
            }
            else {
                this.handlers.log[handler.nodeId].cb = logRequest.logHandler;
                this.handlers.log[handler.nodeId].instance = logRequest.instance;
                this.handlers.log[handler.nodeId].level = logRequest.level;
                if (logRequest.level) {
                    this.handlers.log[handler.nodeId].compareLevel = logLevels.indexOf(logRequest.level);
                }
                else {
                    this.handlers.log[handler.nodeId].compareLevel = undefined;
                }
                if ((_o = logRequest.instance) === null || _o === void 0 ? void 0 : _o.includes('*')) {
                    try {
                        const p = pattern2RegEx(logRequest.instance);
                        this.handlers.log[handler.nodeId].instanceRx = p ? new RegExp(p) : undefined;
                    }
                    catch (e) {
                        (_p = this.log) === null || _p === void 0 ? void 0 : _p.warn(`Invalid pattern on subscribe: ${e.message}`);
                    }
                }
                else {
                    this.handlers.log[handler.nodeId].instanceRx = undefined;
                }
            }
            if (this.handlers.state[handler.nodeId]) {
                this.subscribeOnState(handler.nodeId, '', this.handlers.state[handler.nodeId].oid);
                delete this.handlers.state[handler.nodeId];
            }
            if (this.handlers.object[handler.nodeId]) {
                this.subscribeOnObject(handler.nodeId, '', this.handlers.object[handler.nodeId].oid);
                delete this.handlers.object[handler.nodeId];
            }
            if (this.handlers.file[handler.nodeId]) {
                await this.subscribeOnFile(handler.nodeId, { oid: '', fileName: '' }, {
                    oid: this.handlers.file[handler.nodeId].oid,
                    fileName: this.handlers.file[handler.nodeId].fileName,
                });
                delete this.handlers.file[handler.nodeId];
            }
        }
        if (this._ready) {
            if (wasSubscribed && !Object.keys(this.handlers.log).length) {
                this.log.info(`Unsubscribing from logs as no handlers are registered`);
                void ((_q = this.requireLog) === null || _q === void 0 ? void 0 : _q.call(this, false));
            }
            else if (!wasSubscribed && Object.keys(this.handlers.log).length) {
                this.log.info(`Subscribing to logs as handlers are registered`);
                await ((_r = this.requireLog) === null || _r === void 0 ? void 0 : _r.call(this, true));
            }
        }
    }
    async setIobObject(oid, obj) {
        if (this._ready) {
            try {
                let existingObj = await this.getForeignObjectAsync(oid);
                if (existingObj) {
                    if (obj.common) {
                        existingObj.common = existingObj.common || {};
                        existingObj.common = { ...existingObj.common, ...obj.common };
                    }
                    if (obj.native) {
                        existingObj.native = existingObj.native || {};
                        existingObj.native = { ...existingObj.native, ...obj.native };
                    }
                }
                else {
                    existingObj = obj;
                }
                return this.setForeignObjectAsync(oid, existingObj);
            }
            catch {
                return this.setForeignObjectAsync(oid, obj);
            }
        }
        return new Promise((resolve, reject) => {
            this.requests.setObject.push({
                oid,
                obj,
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to set object ${oid}`));
                    }
                    else {
                        resolve(result);
                    }
                },
            });
        });
    }
    async getIobObject(oid) {
        if (this._ready) {
            return this.getForeignObjectAsync(oid);
        }
        return new Promise((resolve, reject) => {
            this.requests.getObject.push({
                oid,
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to set object ${oid}`));
                    }
                    else {
                        resolve(result);
                    }
                },
            });
        });
    }
    async setIobState(oid, state) {
        if (this._ready) {
            return this.setForeignStateAsync(oid, state);
        }
        return new Promise((resolve, reject) => {
            this.requests.setState.push({
                oid,
                state,
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to set object ${oid}`));
                    }
                    else {
                        resolve(result);
                    }
                },
            });
        });
    }
    async getIobState(oid) {
        if (this._ready) {
            return this.getForeignStateAsync(oid);
        }
        return new Promise((resolve, reject) => {
            this.requests.getState.push({
                oid,
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to set object ${oid}`));
                    }
                    else {
                        resolve(result);
                    }
                },
            });
        });
    }
    async setIobFile(oid, fileName, file, base64) {
        if (this._ready) {
            if (base64 && typeof file === 'string') {
                file = Buffer.from(file, 'base64');
            }
            return this.writeFileAsync(oid, fileName, file);
        }
        return new Promise((resolve, reject) => {
            this.requests.setFile.push({
                oid,
                fileName,
                file,
                base64,
                cb: (error) => {
                    if (error) {
                        reject(new Error(`Failed to set object ${oid}`));
                    }
                    else {
                        resolve();
                    }
                },
            });
        });
    }
    async getIobFile(oid, fileName, base64) {
        if (this._ready) {
            const data = await this.readFileAsync(oid, fileName);
            if (base64 && data.file) {
                data.file = Buffer.from(data.file).toString('base64');
            }
            return data || null;
        }
        return new Promise((resolve, reject) => {
            this.requests.getFile.push({
                oid,
                fileName,
                base64,
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to write file ${oid}`));
                    }
                    else {
                        resolve(result || null);
                    }
                },
            });
        });
    }
    writeIobLog(message, level) {
        if (this._ready) {
            this.log[level || 'info'](message);
        }
        else {
            this.requests.writeLog.push({ message, level: level || 'info' });
        }
    }
    async readIobLog(level, instance, count) {
        if (this._ready) {
            return await (0, LogUtils_1.readLastLogFile)(this, level, instance, count);
        }
        return new Promise((resolve, reject) => {
            this.requests.getLogs.push({
                level: level,
                instance,
                count,
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to read logs: ${error}`));
                    }
                    else {
                        resolve(result || []);
                    }
                },
            });
        });
    }
    readIobEnums(type, language, withIcons) {
        if (this._ready) {
            this.log.info(`Reading enums of type ${type}`);
            return this._readEnums(type, language, withIcons);
        }
        return new Promise((resolve, reject) => {
            this.requests.readEnums.push({
                type,
                language,
                withIcons,
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to read enums of type ${type}`));
                    }
                    else {
                        resolve(result || []);
                    }
                },
            });
        });
    }
    async _readEnums(type, language, withIcons) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const enums = await this.getObjectViewAsync('system', 'enum', {
            startkey: `enum.${type}.`,
            endkey: `enum.${type}.\u9999`,
        });
        const result = [];
        const objects = {};
        for (let e = 0; e < enums.rows.length; e++) {
            const enumObj = enums.rows[e].value;
            const oneEnum = {
                id: enumObj._id,
                name: (language && enumObj.common
                    ? getText(enumObj.common.name, language)
                    : (_a = enumObj.common) === null || _a === void 0 ? void 0 : _a.name) ||
                    enumObj._id.split('.').pop() ||
                    '',
                color: enumObj.common.color,
                icon: withIcons ? enumObj.common.icon : undefined,
                items: [],
            };
            result.push(oneEnum);
            if ((_b = enumObj === null || enumObj === void 0 ? void 0 : enumObj.common) === null || _b === void 0 ? void 0 : _b.members) {
                for (const member of enumObj.common.members) {
                    let obj = objects[member];
                    if (obj === undefined) {
                        try {
                            objects[member] = await this.getForeignObjectAsync(member);
                        }
                        catch {
                            objects[member] = false;
                        }
                        obj = objects[member];
                    }
                    if (obj) {
                        oneEnum.items.push({
                            id: member,
                            type: obj.type,
                            name: (language && obj.common ? getText(obj.common.name, language) : obj.common.name) ||
                                member.split('.').pop() ||
                                '',
                            color: (_c = obj.common) === null || _c === void 0 ? void 0 : _c.color,
                            icon: withIcons ? (_d = obj.common) === null || _d === void 0 ? void 0 : _d.icon : undefined,
                            stateType: (_e = obj.common) === null || _e === void 0 ? void 0 : _e.type,
                            min: (_f = obj.common) === null || _f === void 0 ? void 0 : _f.min,
                            max: (_g = obj.common) === null || _g === void 0 ? void 0 : _g.max,
                            unit: (_h = obj.common) === null || _h === void 0 ? void 0 : _h.unit,
                            role: (_j = obj.common) === null || _j === void 0 ? void 0 : _j.role,
                            step: (_k = obj.common) === null || _k === void 0 ? void 0 : _k.step,
                        });
                    }
                }
            }
        }
        return result;
    }
    readIobDevices(language) {
        if (this._ready) {
            this.log.info(`Reading devices`);
            return this._readDevices(language);
        }
        return new Promise((resolve, reject) => {
            this.requests.readDevices.push({
                language,
                cb: (error, devices) => {
                    if (error) {
                        reject(new Error('Failed to read devices'));
                    }
                    else {
                        resolve(devices || []);
                    }
                },
            });
        });
    }
    async _readDevices(language) {
        var _a;
        if (((_a = this.cache) === null || _a === void 0 ? void 0 : _a.ts) + 30000 > Date.now() && this.cache.devices) {
            return this.cache.devices;
        }
        this.cache = {
            ts: Date.now(),
            devices: await (0, DevicesUtils_1.getAiFriendlyStructure)(this, language || this.ownLanguage),
        };
        return this.cache.devices || [];
    }
    async _getInstances() {
        const result = await this.getObjectViewAsync('system', 'instance', {
            startkey: 'system.adapter.',
            endkey: 'system.adapter.\u9999',
        });
        const instances = result.rows.map((row) => {
            const namespace = row.id.replace('system.adapter.', '');
            let name = getText(row.value.common.titleLang || row.value.common.title || '', 'en') || namespace;
            const [adapterName, instance] = namespace.split('.');
            if (name === adapterName) {
                name = namespace;
            }
            else if (!name.includes(instance)) {
                name = `${name} [${namespace}]`;
            }
            return {
                value: row.id.replace('system.adapter.', ''),
                name,
            };
        });
        instances.unshift({
            value: '',
            name: 'Any instance',
        });
        return instances;
    }
    async getInstances() {
        if (this._ready) {
            return this._getInstances();
        }
        return new Promise((resolve, reject) => {
            this.requests.instances.push({
                cb: (error, result) => {
                    if (error) {
                        reject(new Error(`Failed to read instances`));
                    }
                    else {
                        resolve(result || []);
                    }
                },
            });
        });
    }
}
exports.N8NNodeAdapter = N8NNodeAdapter;
let adapter;
async function getAdapter(handler) {
    adapter || (adapter = new N8NNodeAdapter());
    if (handler) {
        await adapter.registerHandler(handler);
    }
    return adapter;
}
//# sourceMappingURL=IobAdapter.js.map