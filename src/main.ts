import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { execute } from '@oclif/core';
import { join } from 'node:path';
import express, { type Express, NextFunction, type Request, type Response } from 'express';
import session from 'express-session';

import {
    Adapter,
    type AdapterOptions,
    getAbsoluteDefaultDataDir,
    EXIT_CODES,
    commonTools,
} from '@iobroker/adapter-core';
import type { IOSocketClass } from 'iobroker.ws';
import { WebServer, checkPublicIP } from '@iobroker/webserver';
import type { N8NAdapterConfig } from './types';
import { SocketAdmin, type Server, type Store, type SocketSettings } from '@iobroker/socket-classes';
import { SocketIO } from '@iobroker/ws-server';

interface WebStructure {
    server: null | (Server & { __server: WebStructure });
    io: null | IOSocketClass;
    app: Express | null;
}

export class N8NAdapter extends Adapter {
    declare config: N8NAdapterConfig;
    private webServer: WebStructure = {
        server: null,
        io: null,
        app: null,
    };
    private checkTimeout: ioBroker.Timeout | undefined = null;
    private store: Store | null = null;
    private readonly bruteForce: { [userName: string]: { errors: number; time: number } } = {};
    private socket: SocketAdmin | null = null;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'n8n',
            unload: cb => {
                this.destroyN8n();
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
                            await checkPublicIP(this.config.port, 'ioBroker.web', '/iobroker_check.html');
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

    copyFilesToN8N(): void {
        const srcDir = join(__dirname, '..', 'n8n-nodes-iobroker', 'dist');
        const dstDir = join(process.env.N8N_USER_FOLDER!, '.n8n', 'nodes', 'node_modules', 'n8n-nodes-iobroker');
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

        const dirNameWeb = require.resolve('n8n-editor-ui');
        const parts = dirNameWeb.replace(/\\/g, '/').split('/');
        parts.pop();
        const distPath = `${parts.join('/')}/dist`;
        let indexHtml = readFileSync(`${distPath}/index.html`).toString();
        if (!indexHtml.includes('iobrokerSelectId')) {
            // Place before first <title> tag the script
            indexHtml = indexHtml.replace(
                '<title>',
                `<script src="/assets/socket.iob.js" crossorigin></script>
        <script src="/assets/iobrokerSelectId.umd.js" crossorigin></script>
        <script src="/assets/iobroker.js" crossorigin></script>
        <title>`,
            );
            writeFileSync(`${parts.join('/')}/dist/index.html`, indexHtml);
        }
        copyFileSync(
            `${__dirname}/../n8n-nodes-iobroker/nodes/IoBrokerNodes/iobroker.js`,
            `${distPath}/assets/iobroker.js`,
        );
        copyFileSync(`${__dirname}/../public/index.html`, `${distPath}/assets/iobroker.html`);
        const ioBrokerSelectId = require.resolve('@iobroker/webcomponent-selectid-dialog').replace('.es.', '.umd.');
        copyFileSync(ioBrokerSelectId, `${distPath}/assets/iobrokerSelectId.umd.js`);
        copyFileSync(ioBrokerSelectId, `${__dirname}/../public/iobrokerSelectId.umd.js`);

        const ioBrokerWs = require.resolve('@iobroker/ws');
        copyFileSync(
            ioBrokerWs.replace(/\\/g, '/').replace('/cjs/socket.io.js', '/esm/socket.io.min.js'),
            `${distPath}/assets/socket.iob.js`,
        );
        copyFileSync(
            ioBrokerWs.replace(/\\/g, '/').replace('/cjs/socket.io.js', '/esm/socket.io.min.js'),
            `${__dirname}/../public/socket.iob.js`,
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
        process.env.N8N_RUNNERS_ENABLED = 'true';
        if (this.instance === 0) {
            process.env.N8N_USER_FOLDER = join(getAbsoluteDefaultDataDir(), 'n8n');
        } else {
            process.env.N8N_USER_FOLDER = join(getAbsoluteDefaultDataDir(), `n8n.${this.instance}`);
        }
        setDefaultResultOrder('ipv4first');
        setDefaultAutoSelectFamily?.(false);

        this.copyFilesToN8N();

        await this.startWebServer();

        const dirName = require.resolve('n8n');

        await execute({ dir: dirName, args: ['start'] });
    }

    private destroyN8n(): void {
        if (this.checkTimeout) {
            this.clearTimeout(this.checkTimeout);
            this.checkTimeout = undefined;
        }
        this.log.info('Destroying N8N integration');
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
