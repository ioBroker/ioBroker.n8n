import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { execSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import {
    Adapter,
    type AdapterOptions,
    getAbsoluteDefaultDataDir,
    EXIT_CODES,
    commonTools,
} from '@iobroker/adapter-core';

const N8N_USER_FOLDER = join(getAbsoluteDefaultDataDir(), 'n8n');

const N8N_VERSION = '1.102.3';

import type { IOSocketClass } from 'iobroker.ws';
import { WebServer, checkPublicIP } from '@iobroker/webserver';
import type { N8NAdapterConfig } from './types';
import { SocketAdmin, type Server, type Store, type SocketSettings } from '@iobroker/socket-classes';
import { SocketIO } from '@iobroker/ws-server';
import { exec } from 'child_process';

interface WebStructure {
    server: null | (Server & { __server: WebStructure });
    io: null | IOSocketClass;
    app: Express | null;
}

export class N8NAdapter extends Adapter {
    declare config: N8NAdapterConfig;
    private n8nProcess: any = null;
    private webServer: WebStructure = {
        server: null,
        io: null,
        app: null,
    };
    private checkTimeout: ioBroker.Timeout | undefined = null;
    private store: Store | null = null;
    private readonly bruteForce: { [userName: string]: { errors: number; time: number } } = {};
    private socket: SocketAdmin | null = null;
    private killResolve: (() => void) | null = null;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'n8n',
            unload: async (cb): Promise<void> => {
                await this.destroyN8n();
                cb?.();
            },
            ready: async (): Promise<void> => this.main(),
            // message: async obj => this.onMessage(obj),
        });
    }

    private copyDirectory(src: string, dst: string): void {
        if (!existsSync(dst)) {
            mkdirSync(dst, { recursive: true });
        }
        const files = readdirSync(src);
        for (const file of files) {
            const srcFile = join(src, file);
            const dstFile = join(dst, file);
            if (lstatSync(srcFile).isFile()) {
                copyFileSync(srcFile, dstFile);
            } else if (lstatSync(srcFile).isDirectory()) {
                // If it's a directory, copy recursively
                this.copyDirectory(srcFile, dstFile);
            }
        }
    }

    initSocket(server: Server): void {
        const AdapterStore = commonTools.session(session, 3600);
        this.store = new AdapterStore({ adapter: this });

        const settings: SocketSettings = {
            language: 'en',
            defaultUser: 'admin',
            ttl: this.config.ttl,
            secure: this.config.secure,
            auth: false,
            port: this.config.port || 5680,
            noInfoConnected: true,
        };

        this.socket = new SocketAdmin(settings, this);
        this.socket.start(server, SocketIO, {
            store: this.store!,
            oauth2Only: false,
            noBasicAuth: true,
        });
    }

    async startWebServer(): Promise<void> {
        this.webServer.app = express();
        // this.webServer.app.use(compression());
        this.webServer.app.disable('x-powered-by');

        this.webServer.app.get('/iobroker_check.html', (req: Request, res: Response): void => {
            res.send('ioBroker.web');
        });

        this.webServer.app.use((req: Request, res: Response, next: NextFunction): void => {
            if (req.method === 'GET') {
                const file = req.url?.split('?')[0] || '';
                if (file === '/favicon.ico') {
                    res.status(200).setHeader('Content-Type', 'image/x-icon');
                    res.send(readFileSync(`${__dirname}/../public/favicon.ico`));
                    return;
                }
                if (file === '/index.html' || file === '/' || !file) {
                    res.status(200).setHeader('Content-Type', 'text/html');
                    res.send(readFileSync(`${__dirname}/../public/index.html`));
                    return;
                }
                if (file === '/iobrokerSelectId.umd.js') {
                    res.status(200).setHeader('Content-Type', 'application/javascript');
                    res.send(readFileSync(`${__dirname}/../public/iobrokerSelectId.umd.js`));
                    return;
                }
                if (file === '/socket.iob.js') {
                    res.status(200).setHeader('Content-Type', 'application/javascript');
                    res.send(readFileSync(`${__dirname}/../public/socket.iob.js`));
                    return;
                }
            }
            next();
        });

        // reverse proxy with url rewrite for couchdb attachments in <adapter-name>.admin
        this.webServer.app.use('/adapter/', (req: Request, res: Response): void => {
            let url: string;
            try {
                url = decodeURIComponent(req.url);
            } catch {
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
            this.readFile(id, url, null, (err, buffer, mimeType): void => {
                if (!buffer || err) {
                    res.contentType('text/html');
                    res.status(404).send(`File not found`);
                } else {
                    if (mimeType) {
                        res.contentType(mimeType);
                    } else {
                        try {
                            //const _mimeType = getType(url);
                            res.contentType('text/javascript');
                        } catch {
                            res.contentType('text/javascript');
                        }
                    }
                    res.send(buffer);
                }
            });
        });

        try {
            const webserver = new WebServer({
                app: this.webServer.app,
                adapter: this,
                secure: this.config.secure,
            });
            this.webServer.server = (await webserver.init()) as Server & { __server: WebStructure };
        } catch (err) {
            this.log.error(`Cannot create web-server: ${err}`);
            this.terminate
                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }
        if (!this.webServer.server) {
            this.log.error(`Cannot create web-server`);
            this.terminate
                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
            return;
        }

        this.webServer.server.__server = this.webServer;

        this.webServer.server.listen(
            this.config.port || 5680,
            !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
            () => {
                if (!this.config.doNotCheckPublicIP && !this.config.auth) {
                    this.checkTimeout = this.setTimeout(async () => {
                        this.checkTimeout = null;
                        try {
                            await checkPublicIP(this.config.port || 5680, 'ioBroker.web', '/iobroker_check.html');
                        } catch (e) {
                            // this supported first from js-controller 5.0.
                            this.sendToHost(
                                `system.host.${this.host}`,
                                'addNotification',
                                {
                                    scope: 'system',
                                    category: 'securityIssues',
                                    message:
                                        'Your web instance is accessible from the internet without any protection. ' +
                                        'Please enable authentication or disable the access from the internet.',
                                    instance: `system.adapter.${this.namespace}`,
                                },
                                (/* result */) => {
                                    /* ignore */
                                },
                            );

                            this.log.error(e.toString());
                        }
                    }, 1000);
                }
            },
        );

        this.log.info(`http${this.config.secure ? 's' : ''} server listening on port ${this.config.port || 5680}`);

        this.initSocket(this.webServer.server);
    }

    getNpmCommand(n8nDir: string): string {
        // Try to find a path to npm
        if (process.platform === 'win32') {
            try {
                const stdout = execSync('"C:\\Program Files\\nodejs\\npm.cmd" -v', { cwd: n8nDir });
                if (stdout) {
                    return '"C:\\Program Files\\nodejs\\npm.cmd"';
                }
            } catch {
                try {
                    const stdout = execSync('where npm', { cwd: n8nDir });
                    if (stdout?.toString().trim()) {
                        return stdout.toString().trim().split('\n')[0].trim();
                    }
                } catch {
                    // ignore
                }
            }
        }

        try {
            const stdout = execSync('npm -v', { cwd: n8nDir });
            if (stdout) {
                return 'npm';
            }
        } catch {
            // ignore
        }

        this.log.warn('The location of npm is unknown!');

        return 'npm';
    }

    async installN8N(): Promise<string> {
        const n8nDir = `${getAbsoluteDefaultDataDir()}n8n-engine`;
        if (!existsSync(n8nDir)) {
            mkdirSync(n8nDir);
        }
        let forceInstall = false;
        if (!existsSync(`${n8nDir}/package.json`)) {
            writeFileSync(
                `${n8nDir}/package.json`,
                JSON.stringify(
                    {
                        name: 'n8n-engin',
                        version: '0.0.8',
                        private: true,
                        dependencies: {
                            n8n: N8N_VERSION,
                        },
                    },
                    null,
                    4,
                ),
            );
            forceInstall = true;
        } else {
            const pack = JSON.parse(readFileSync(`${n8nDir}/package.json`).toString());
            if (pack.dependencies.n8n !== N8N_VERSION) {
                writeFileSync(
                    `${n8nDir}/package.json`,
                    JSON.stringify(
                        {
                            name: 'n8n-engin',
                            version: '0.0.8',
                            private: true,
                            dependencies: {
                                n8n: N8N_VERSION,
                            },
                        },
                        null,
                        4,
                    ),
                );
                forceInstall = true;
            }
        }

        if (forceInstall || !existsSync(`${n8nDir}/node_modules`)) {
            this.log.info('Executing n8n installation... Please wait it can take a while!');
            await new Promise<void>((resolve, reject) => {
                const npmCommand = this.getNpmCommand(n8nDir);
                this.log.debug(`executing: "${npmCommand} install --omit=dev" in "${n8nDir}"`);
                const child = exec(`${npmCommand} install --omit=dev`, { cwd: n8nDir });

                child.stdout?.on('data', (data: Buffer) => this.log.debug(`[n8n-install] ${data.toString()}`));

                child.stderr?.on('data', (data: Buffer) => this.log.debug(`[n8n-install] ${data.toString()}`));

                child.on('exit', (code /* , signal */) => {
                    // code 1 is a strange error that cannot be explained. Everything is installed but error :(
                    if (code && code !== 1) {
                        reject(new Error(`Cannot install: ${code}`));
                    } else {
                        this.log.info('n8n is installed');
                        // command succeeded
                        resolve();
                    }
                });
            });
        }

        return n8nDir;
    }

    copyFilesToN8N(n8nDir: string): void {
        const srcDir = join(__dirname, '..', 'n8n-nodes-iobroker', 'dist');
        const dstDir = join(N8N_USER_FOLDER, '.n8n', 'nodes', 'node_modules', 'n8n-nodes-iobroker');
        if (!existsSync(dstDir)) {
            mkdirSync(dstDir, { recursive: true });
        }
        copyFileSync(join(srcDir, '../index.js'), join(dstDir, 'index.js'));
        const oldPackageJson = existsSync(join(dstDir, 'package.json'))
            ? JSON.parse(readFileSync(join(dstDir, 'package.json')).toString())
            : { version: '0.0.0' };
        const newPackageJson = JSON.parse(readFileSync(join(srcDir, '../package.json')).toString());
        copyFileSync(join(srcDir, '../package.json'), join(dstDir, 'package.json'));
        if (!existsSync(`${dstDir}/dist/nodes`)) {
            mkdirSync(`${dstDir}/dist/nodes`, { recursive: true });
        }
        // Copy all files from srcDir/nodes to dstDir/dist/nodes
        const nodesDir = join(srcDir, 'nodes');
        if (existsSync(nodesDir)) {
            this.copyDirectory(nodesDir, join(dstDir, 'dist', 'nodes'));
        }

        const distPath = `${n8nDir}/node_modules/n8n-editor-ui/dist`;
        let indexHtml = readFileSync(`${distPath}/index.html`).toString();
        if (!indexHtml.includes('iobroker')) {
            // Place before first <title> tag the script
            indexHtml = indexHtml.replace(
                '<title>',
                `<script src="/assets/socket.iob.js" crossorigin></script>
        <script src="/assets/iobroker.js" crossorigin></script>
        <script src="/assets/iobrokerSelectId.umd.js" crossorigin></script>
        <title>`,
            );
            writeFileSync(`${distPath}/index.html`, indexHtml);
        }
        copyFileSync(
            `${__dirname}/../n8n-nodes-iobroker/nodes/IoBrokerNodes/iobroker.js`,
            `${distPath}/assets/iobroker.js`,
        );
        copyFileSync(`${__dirname}/../public/index.html`, `${distPath}/assets/iobroker.html`);
        const ioBrokerSelectId = require.resolve('@iobroker/webcomponent-selectid-dialog').replace('.es.', '.umd.');
        copyFileSync(ioBrokerSelectId, `${distPath}/assets/iobrokerSelectId.umd.js`);

        const ioBrokerWs = require.resolve('@iobroker/ws');
        copyFileSync(
            ioBrokerWs.replace(/\\/g, '/').replace('/cjs/socket.io.js', '/esm/socket.io.min.js'),
            `${distPath}/assets/socket.iob.js`,
        );

        // Check if node_modules directory exists in the n8n user folder
        if (!existsSync(`${dstDir}/node_modules`) || oldPackageJson.version !== newPackageJson.version) {
            // run npm install in the n8n user folder
            try {
                this.log.debug('Running npm install in the n8n user folder');
                execSync('npm install', { cwd: dstDir, stdio: 'inherit' });
            } catch (error) {
                this.log.error(`Error running npm install: ${error}`);
            }
        } else {
            // Check if the version of n8n-nodes-iobroker is correct
        }
    }

    private async main(): Promise<void> {
        this.log.info('N8N Adapter started');

        setDefaultResultOrder('ipv4first');
        setDefaultAutoSelectFamily?.(false);

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
        const env: Record<string, string> = {
            N8N_RUNNERS_ENABLED: 'true',
            N8N_USER_FOLDER,
            N8N_SECURE_COOKIE: 'false',
            PATH: process.env.PATH!,
        };
        if (process.platform !== 'win32') {
            env.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS = 'false';
        }

        // System call used for update of js-controller itself,
        // because during an installation the npm packet will be deleted too, but some files must be loaded even during the install process.
        this.n8nProcess = spawn('node', ['node_modules/n8n/bin/n8n'], { cwd: n8nDir, env });

        this.n8nProcess.stdout.on('data', (data: Buffer) => {
            this.log.debug(`[n8n] ${data.toString()}`);
        });

        this.n8nProcess.stderr.on('data', (data: Buffer) => {
            this.log.error(`[n8n] ${data.toString()}`);
        });

        this.n8nProcess.on('exit', (code: number /* , signal */) => {
            // code 1 is a strange error that cannot be explained. Everything is installed but error :(
            if (code && code !== 1) {
                this.log.error(`n8n stopped with error: ${code}`);
            } else {
                // command succeeded
                this.log.debug('n8n stopped');
            }
            this.n8nProcess = null;
            this.killResolve?.();
        });
    }

    private async destroyN8n(): Promise<void> {
        if (this.checkTimeout) {
            this.clearTimeout(this.checkTimeout);
            this.checkTimeout = undefined;
        }
        this.log.info('Destroying N8N integration');
        if (this.n8nProcess) {
            const killPromise = new Promise<void>(resolve => {
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

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new N8NAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new N8NAdapter())();
}
