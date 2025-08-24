"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.N8NAdapter = void 0;
const node_dns_1 = require("node:dns");
const node_net_1 = require("node:net");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const adapter_core_1 = require("@iobroker/adapter-core");
const N8N_USER_FOLDER = (0, node_path_1.join)((0, adapter_core_1.getAbsoluteDefaultDataDir)(), 'n8n');
const pack = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, '..', 'package.json'), 'utf-8'));
// Read the version of n8n from the dependencies so dependabot can update it
const N8N_VERSION = pack.devDependencies.n8n || pack.dependencies.n8n || '1.99.0';
const webserver_1 = require("@iobroker/webserver");
const socket_classes_1 = require("@iobroker/socket-classes");
const ws_server_1 = require("@iobroker/ws-server");
const child_process_1 = require("child_process");
class N8NAdapter extends adapter_core_1.Adapter {
    n8nProcess = null;
    webServer = {
        server: null,
        io: null,
        app: null,
    };
    checkTimeout = null;
    store = null;
    bruteForce = {};
    socket = null;
    killResolve = null;
    constructor(options = {}) {
        super({
            ...options,
            name: 'n8n',
            unload: async (cb) => {
                await this.destroyN8n();
                cb?.();
            },
            ready: async () => this.main(),
            // message: async obj => this.onMessage(obj),
        });
    }
    copyDirectory(src, dst) {
        if (!(0, node_fs_1.existsSync)(dst)) {
            (0, node_fs_1.mkdirSync)(dst, { recursive: true });
        }
        const files = (0, node_fs_1.readdirSync)(src);
        for (const file of files) {
            const srcFile = (0, node_path_1.join)(src, file);
            const dstFile = (0, node_path_1.join)(dst, file);
            if ((0, node_fs_1.lstatSync)(srcFile).isFile()) {
                (0, node_fs_1.copyFileSync)(srcFile, dstFile);
            }
            else if ((0, node_fs_1.lstatSync)(srcFile).isDirectory()) {
                // If it's a directory, copy recursively
                this.copyDirectory(srcFile, dstFile);
            }
        }
    }
    initSocket(server) {
        const AdapterStore = adapter_core_1.commonTools.session(express_session_1.default, 3600);
        this.store = new AdapterStore({ adapter: this });
        const settings = {
            language: 'en',
            defaultUser: 'admin',
            ttl: this.config.ttl,
            secure: this.config.secure,
            auth: false,
            port: this.config.port || 5680,
            noInfoConnected: true,
        };
        this.socket = new socket_classes_1.SocketAdmin(settings, this);
        this.socket.start(server, ws_server_1.SocketIO, {
            store: this.store,
            oauth2Only: false,
            noBasicAuth: true,
        });
    }
    async startWebServer() {
        this.webServer.app = (0, express_1.default)();
        // this.webServer.app.use(compression());
        this.webServer.app.disable('x-powered-by');
        this.webServer.app.get('/iobroker_check.html', (req, res) => {
            res.send('ioBroker.web');
        });
        this.webServer.app.use((req, res, next) => {
            if (req.method === 'GET') {
                const file = req.url?.split('?')[0] || '';
                if (file === '/favicon.ico') {
                    res.status(200).setHeader('Content-Type', 'image/x-icon');
                    res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/favicon.ico`));
                    return;
                }
                if (file === '/index.html' || file === '/' || !file) {
                    res.status(200).setHeader('Content-Type', 'text/html');
                    res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/index.html`));
                    return;
                }
                if (file === '/iobrokerSelectId.umd.js') {
                    res.status(200).setHeader('Content-Type', 'application/javascript');
                    res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/iobrokerSelectId.umd.js`));
                    return;
                }
                if (file === '/socket.iob.js') {
                    res.status(200).setHeader('Content-Type', 'application/javascript');
                    res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/socket.iob.js`));
                    return;
                }
            }
            next();
        });
        // reverse proxy with url rewrite for couchdb attachments in <adapter-name>.admin
        this.webServer.app.use('/adapter/', (req, res) => {
            let url;
            try {
                url = decodeURIComponent(req.url);
            }
            catch {
                // ignore
                url = req.url;
            }
            // add index.html
            url = url.replace(/\/($|\?|#)/, '/index.html$1');
            const parts = url.split('/');
            // Skip first /
            parts.shift();
            // Get ID
            const adapterName = parts.shift();
            const id = `${adapterName}.admin`;
            url = parts.join('/');
            // this.adapter.readFile is sanitized
            this.readFile(id, url, null, (err, buffer, mimeType) => {
                if (!buffer || err) {
                    res.contentType('text/html');
                    res.status(404).send(`File not found`);
                }
                else {
                    if (mimeType) {
                        res.contentType(mimeType);
                    }
                    else {
                        try {
                            //const _mimeType = getType(url);
                            res.contentType('text/javascript');
                        }
                        catch {
                            res.contentType('text/javascript');
                        }
                    }
                    res.send(buffer);
                }
            });
        });
        try {
            const webserver = new webserver_1.WebServer({
                app: this.webServer.app,
                adapter: this,
                secure: this.config.secure,
            });
            this.webServer.server = (await webserver.init());
        }
        catch (err) {
            this.log.error(`Cannot create web-server: ${err}`);
            this.terminate
                ? this.terminate(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }
        if (!this.webServer.server) {
            this.log.error(`Cannot create web-server`);
            this.terminate
                ? this.terminate(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }
        this.webServer.server.__server = this.webServer;
        this.webServer.server.listen(this.config.port || 5680, !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined, () => {
            if (!this.config.doNotCheckPublicIP && !this.config.auth) {
                this.checkTimeout = this.setTimeout(async () => {
                    this.checkTimeout = null;
                    try {
                        await (0, webserver_1.checkPublicIP)(this.config.port || 5680, 'ioBroker.web', '/iobroker_check.html');
                    }
                    catch (e) {
                        // this supported first from js-controller 5.0.
                        this.sendToHost(`system.host.${this.host}`, 'addNotification', {
                            scope: 'system',
                            category: 'securityIssues',
                            message: 'Your web instance is accessible from the internet without any protection. ' +
                                'Please enable authentication or disable the access from the internet.',
                            instance: `system.adapter.${this.namespace}`,
                        }, ( /* result */) => {
                            /* ignore */
                        });
                        this.log.error(e.toString());
                    }
                }, 1000);
            }
        });
        this.log.info(`http${this.config.secure ? 's' : ''} server listening on port ${this.config.port || 5680}`);
        this.initSocket(this.webServer.server);
    }
    getNpmCommand(n8nDir) {
        // Try to find a path to npm
        if (process.platform === 'win32') {
            try {
                const stdout = (0, node_child_process_1.execSync)('"C:\\Program Files\\nodejs\\npm.cmd" -v', { cwd: n8nDir });
                if (stdout) {
                    return '"C:\\Program Files\\nodejs\\npm.cmd"';
                }
            }
            catch {
                try {
                    const stdout = (0, node_child_process_1.execSync)('where npm', { cwd: n8nDir });
                    if (stdout?.toString().trim()) {
                        return stdout.toString().trim().split('\n')[0].trim();
                    }
                }
                catch {
                    // ignore
                }
            }
        }
        try {
            const stdout = (0, node_child_process_1.execSync)('npm -v', { cwd: n8nDir });
            if (stdout) {
                return 'npm';
            }
        }
        catch {
            // ignore
        }
        this.log.warn('The location of npm is unknown!');
        return 'npm';
    }
    async installN8N() {
        const n8nDir = `${(0, adapter_core_1.getAbsoluteDefaultDataDir)()}n8n-engine`;
        if (!(0, node_fs_1.existsSync)(n8nDir)) {
            (0, node_fs_1.mkdirSync)(n8nDir);
        }
        let forceInstall = false;
        if (!(0, node_fs_1.existsSync)(`${n8nDir}/package.json`)) {
            (0, node_fs_1.writeFileSync)(`${n8nDir}/package.json`, JSON.stringify({
                name: 'n8n-engine',
                version: '0.0.8',
                private: true,
                dependencies: {
                    n8n: N8N_VERSION,
                },
            }, null, 4));
            forceInstall = true;
        }
        else {
            const pack = JSON.parse((0, node_fs_1.readFileSync)(`${n8nDir}/package.json`).toString());
            if (pack.dependencies.n8n !== N8N_VERSION) {
                (0, node_fs_1.writeFileSync)(`${n8nDir}/package.json`, JSON.stringify({
                    name: 'n8n-engine',
                    version: '0.0.8',
                    private: true,
                    dependencies: {
                        n8n: N8N_VERSION,
                    },
                }, null, 4));
                forceInstall = true;
            }
        }
        if (forceInstall || !(0, node_fs_1.existsSync)(`${n8nDir}/node_modules`)) {
            this.log.info('Executing n8n installation... Please wait it can take a while!');
            await new Promise((resolve, reject) => {
                const npmCommand = this.getNpmCommand(n8nDir);
                this.log.debug(`executing: "${npmCommand} install --omit=dev" in "${n8nDir}"`);
                const child = (0, child_process_1.exec)(`${npmCommand} install --omit=dev`, { cwd: n8nDir });
                child.stdout?.on('data', (data) => this.log.debug(`[n8n-install] ${data.toString()}`));
                child.stderr?.on('data', (data) => this.log.debug(`[n8n-install] ${data.toString()}`));
                child.on('exit', (code /* , signal */) => {
                    // code 1 is a strange error that cannot be explained. Everything is installed but error :(
                    if (code && code !== 1) {
                        reject(new Error(`Cannot install: ${code}`));
                    }
                    else {
                        this.log.info('n8n is installed');
                        // command succeeded
                        resolve();
                    }
                });
            });
        }
        return n8nDir;
    }
    copyFilesToN8N(n8nDir) {
        const srcDir = (0, node_path_1.join)(__dirname, '..', 'n8n-nodes-iobroker', 'dist');
        const dstDir = (0, node_path_1.join)(N8N_USER_FOLDER, '.n8n', 'nodes', 'node_modules', 'n8n-nodes-iobroker');
        if (!(0, node_fs_1.existsSync)(dstDir)) {
            (0, node_fs_1.mkdirSync)(dstDir, { recursive: true });
        }
        (0, node_fs_1.copyFileSync)((0, node_path_1.join)(srcDir, '../index.js'), (0, node_path_1.join)(dstDir, 'index.js'));
        const oldPackageJson = (0, node_fs_1.existsSync)((0, node_path_1.join)(dstDir, 'package.json'))
            ? JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(dstDir, 'package.json')).toString())
            : { version: '0.0.0' };
        const newPackageJson = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(srcDir, '../package.json')).toString());
        (0, node_fs_1.copyFileSync)((0, node_path_1.join)(srcDir, '../package.json'), (0, node_path_1.join)(dstDir, 'package.json'));
        if (!(0, node_fs_1.existsSync)(`${dstDir}/dist/nodes`)) {
            (0, node_fs_1.mkdirSync)(`${dstDir}/dist/nodes`, { recursive: true });
        }
        // Copy all files from srcDir/nodes to dstDir/dist/nodes
        const nodesDir = (0, node_path_1.join)(srcDir, 'nodes');
        if ((0, node_fs_1.existsSync)(nodesDir)) {
            this.copyDirectory(nodesDir, (0, node_path_1.join)(dstDir, 'dist', 'nodes'));
        }
        const distPath = `${n8nDir}/node_modules/n8n-editor-ui/dist`;
        let indexHtml = (0, node_fs_1.readFileSync)(`${distPath}/index.html`).toString();
        if (!indexHtml.includes('iobroker')) {
            // Place before first <title> tag the script
            indexHtml = indexHtml.replace('<title>', `<script src="/assets/socket.iob.js" crossorigin></script>
        <script src="/assets/iobroker.js" crossorigin></script>
        <script src="/assets/iobrokerSelectId.umd.js" crossorigin></script>
        <title>`);
            (0, node_fs_1.writeFileSync)(`${distPath}/index.html`, indexHtml);
        }
        (0, node_fs_1.copyFileSync)(`${__dirname}/../n8n-nodes-iobroker/nodes/IoBrokerNodes/iobroker.js`, `${distPath}/assets/iobroker.js`);
        (0, node_fs_1.copyFileSync)(`${__dirname}/../public/index.html`, `${distPath}/assets/iobroker.html`);
        const ioBrokerSelectId = require.resolve('@iobroker/webcomponent-selectid-dialog').replace('.es.', '.umd.');
        (0, node_fs_1.copyFileSync)(ioBrokerSelectId, `${distPath}/assets/iobrokerSelectId.umd.js`);
        const ioBrokerWs = require.resolve('@iobroker/ws');
        (0, node_fs_1.copyFileSync)(ioBrokerWs.replace(/\\/g, '/').replace('/cjs/socket.io.js', '/esm/socket.io.min.js'), `${distPath}/assets/socket.iob.js`);
        // Check if node_modules directory exists in the n8n user folder
        if (!(0, node_fs_1.existsSync)(`${dstDir}/node_modules`) || oldPackageJson.version !== newPackageJson.version) {
            // run npm install in the n8n user folder
            try {
                this.log.debug('Running npm install in the n8n user folder');
                (0, node_child_process_1.execSync)('npm install', { cwd: dstDir, stdio: 'inherit' });
            }
            catch (error) {
                this.log.error(`Error running npm install: ${error}`);
            }
        }
        else {
            // Check if the version of n8n-nodes-iobroker is correct
        }
    }
    async main() {
        this.log.info('N8N Adapter started');
        (0, node_dns_1.setDefaultResultOrder)('ipv4first');
        (0, node_net_1.setDefaultAutoSelectFamily)?.(false);
        // Find out of n8n is installed in '../../node_modules' or in '../node_modules'
        const n8nDir = await this.installN8N();
        this.copyFilesToN8N(n8nDir);
        await this.startWebServer();
        // Start N8N process
        /*
        // Simulate loading the configuration
        const config = await Config.load({});

        const { Start } = require(`${__dirname}/../node_modules/n8n/dist/commands/start.js`);

        // Create class instance
        this.n8nProcess = new Start([], config as any);
        const logger = new Logger(this.log);
        // @1ts-expect-error override logger
        this.n8nProcess.logger = logger as any;
        this.n8nProcess.log = (message: string, ...args: any[]): void => {
            // Convert args to a string if they are provided
            if (args.length > 0) {
                message += ` ${args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ')}`;
            }
            const lines = message.split('\n');
            // Log each line separately
            for (const line of lines) {
                if (line.trim()) {
                    this.log.debug(`[n8n] ${line.trim()}`);
                }
            }
        };

        await this.n8nProcess.init();
        await this.n8nProcess.run();
        */
        const env = {
            N8N_RUNNERS_ENABLED: 'true',
            N8N_USER_FOLDER,
            N8N_SECURE_COOKIE: 'false',
            PATH: process.env.PATH,
        };
        if (process.platform !== 'win32') {
            env.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS = 'false';
        }
        // System call used for update of js-controller itself,
        // because during an installation the npm packet will be deleted too, but some files must be loaded even during the install process.
        this.n8nProcess = (0, node_child_process_1.spawn)('node', ['node_modules/n8n/bin/n8n'], { cwd: n8nDir, env });
        this.n8nProcess.stdout.on('data', (data) => {
            this.log.debug(`[n8n] ${data.toString()}`);
        });
        this.n8nProcess.stderr.on('data', (data) => {
            this.log.error(`[n8n] ${data.toString()}`);
        });
        this.n8nProcess.on('exit', (code /* , signal */) => {
            // code 1 is a strange error that cannot be explained. Everything is installed but error :(
            if (code && code !== 1) {
                this.log.error(`n8n stopped with error: ${code}`);
            }
            else {
                // command succeeded
                this.log.debug('n8n stopped');
            }
            this.n8nProcess = null;
            this.killResolve?.();
        });
    }
    async destroyN8n() {
        if (this.checkTimeout) {
            this.clearTimeout(this.checkTimeout);
            this.checkTimeout = undefined;
        }
        this.log.info('Destroying N8N integration');
        if (this.n8nProcess) {
            const killPromise = new Promise(resolve => {
                this.killResolve = resolve;
            });
            this.n8nProcess?.kill();
            await killPromise;
        }
        // Clean up resources, close connections, etc.
        this.webServer?.io?.close();
        this.webServer?.server?.close();
    }
}
exports.N8NAdapter = N8NAdapter;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new N8NAdapter(options);
}
else {
    // otherwise start the instance directly
    (() => new N8NAdapter())();
}
//# sourceMappingURL=main.js.map