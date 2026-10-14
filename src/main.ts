import { setDefaultResultOrder } from 'node:dns';
import { isIP, setDefaultAutoSelectFamily } from 'node:net';
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

const pack = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
// Read the version of n8n from the dependencies so dependabot can update it
const N8N_VERSION = pack.devDependencies.n8n || pack.dependencies.n8n || '1.99.0';

import type { IOSocketClass } from 'iobroker.ws';
import { WebServer, checkPublicIP, CertificateManager, type CertificateCollection } from '@iobroker/webserver';
import type { N8NAdapterConfig } from './types';
import { SocketAdmin, type Server, type Store, type SocketSettings } from '@iobroker/socket-classes';
import { SocketIO } from '@iobroker/ws-server';
import { exec } from 'node:child_process';

interface WebStructure {
    server: null | (Server & { __server: WebStructure });
    io: null | IOSocketClass;
    app: Express | null;
}

/** Feature a js-controller announces once it keeps the per-host registry of used resources. Since js-controller 8. */
const USED_RESOURCES_FEATURE = 'CONTROLLER_USED_RESOURCES';

/** Addresses that stand for every interface: the port is occupied in both address families, so no family is reported */
const WILDCARD_ADDRESSES = ['0.0.0.0', '::', '*', ''];

/** Payload of the `tcpPort` resource type - `ioBroker.TcpPortResourceData` of js-controller 8 */
interface UsedTcpPort {
    /** TCP port number */
    port: number;
    /** Address the socket is bound to, `0.0.0.0` or `::` for every interface */
    bind?: string;
    /** Address family, only reported for a concrete bind address */
    family?: 4 | 6;
}

/**
 * The part of the adapter API used to report the occupied ports. The methods exist since js-controller 8,
 * and `supportsFeature()` is typed against a union of known features that does not contain the feature in older types.
 */
interface UsedResourcesApi {
    registerUsedResource?: (type: 'tcpPort', data: UsedTcpPort) => Promise<void>;
    freeUsedResource?: (type: 'tcpPort', data?: Partial<UsedTcpPort>) => Promise<void>;
    checkUsedResource?: (type: 'tcpPort', data?: Partial<UsedTcpPort>) => Promise<{ instance: string }[]>;
    supportsFeature?: (feature: string) => boolean;
}

/**
 * Port of the n8n task broker (internal task runners) for instance 0 (n8n default), listens on 127.0.0.1 only.
 * Further instances use steps of 10 (n8n.1 → 5689), as "+ instance" would hit the default service port 5680.
 */
const N8N_RUNNERS_BROKER_PORT = 5679;

interface Certificates {
    /** public certificate */
    key: string;
    /** private certificate */
    cert: string;
    /** chained certificate */
    ca?: string;
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
    private certManager: CertificateManager | null = null;
    private stopping = false;
    /** Ports of the n8n process registered in the used resources of the host, so they can be freed when n8n exits */
    private reportedN8nPorts: UsedTcpPort[] = [];
    /** Register and free go to the host one after another, so a free cannot overtake the register it undoes */
    private usedResourcesQueue: Promise<void> = Promise.resolve();

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'n8n',
            unload: async (cb): Promise<void> => {
                this.stopping = true;
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
            port: parseInt(this.config.portAdmin as string, 10) || 5680,
            noInfoConnected: true,
        };

        this.socket = new SocketAdmin(settings, this);
        this.socket.start(server, SocketIO, {
            store: this.store!,
            oauth2Only: false,
            noBasicAuth: true,
        });
    }

    /**
     * Get the custom certificates as text
     */
    async getCustomCertificates(): Promise<Certificates | null> {
        const config = this.config;
        const defaultPublic = config.certPublic || 'defaultPublic';
        const defaultPrivate = config.certPrivate || 'defaultPrivate';
        const defaultChain = config.certChained || '';

        const customCertificates = await this.getCertificatesAsync(defaultPublic, defaultPrivate, defaultChain);
        if (customCertificates && customCertificates[0]) {
            const certs = customCertificates[0];
            if (certs.key.endsWith('.pem')) {
                this.log.error(
                    `Cannot load custom certificates. File "${certs.key}" does not exists or iobroker user has no rights for it.`,
                );
            } else if (certs.cert.endsWith('.pem')) {
                this.log.error(
                    `Cannot load custom certificates. File "${certs.cert}" does not exists or iobroker user has no rights for it.`,
                );
            } else if (certs.ca && typeof certs.ca === 'string' && certs.ca.endsWith('.pem')) {
                this.log.error(
                    `Cannot load custom certificates. File "${certs.ca}" does not exists or iobroker user has no rights for it.`,
                );
            } else {
                return certs;
            }
        }
        return null;
    }

    async getCerts(): Promise<Certificates | null> {
        this.certManager ||= new CertificateManager({ adapter: this });
        let collections: Record<string, CertificateCollection> | null;
        const collectionId: string | boolean | undefined = this.config.leCollection;

        if (collectionId && typeof collectionId === 'string') {
            const collection = (await this.certManager.getCollection(collectionId)) as CertificateCollection | null;
            if (collection) {
                return {
                    key: collection.key.toString(),
                    cert: collection.cert.toString(),
                    ca: collection.chain?.toString(),
                };
            }
            return null;
        }
        if (collectionId !== false) {
            collections = await this.certManager.getAllCollections();
            if (!collections || !Object.keys(collections).length) {
                this.log.warn(
                    'Could not find any certificate collections - check ACME installation or consider installing',
                );
                // Load self-signed or custom certificates for fallback
                const customCertificates = await this.getCustomCertificates();
                if (customCertificates) {
                    this.log.warn('Falling back to self-signed certificates or to custom certificates');
                    return customCertificates;
                }

                // This really should never happen as customCertificatesContext should always be available
                this.log.error('Could not find self-signed certificate - falling back to insecure http createServer');
                return null;
            }

            if (!collections) {
                throw new Error('Cannot create secure server: No certificate collection found');
            }
            const firstCollectionId = Object.keys(collections)[0];
            const firstCollection = collections[firstCollectionId];
            this.certManager.subscribeCollections(
                firstCollectionId,
                (err: Error | null, collections?: Record<string, CertificateCollection>): void => {
                    if (!err && collections) {
                        this.log.info(`Certificate collection ${firstCollectionId} changed - restarting adapter`);
                        // restart adapter as the certificates changed
                        this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    } else {
                        this.log.error(`Cannot subscribe to certificate collection ${firstCollectionId}: ${err}`);
                    }
                },
            );

            return {
                key: firstCollection.key.toString(),
                cert: firstCollection.cert.toString(),
                ca: firstCollection.chain?.toString(),
            };
        }

        // fallback to self-signed or custom certificates
        collections = null;
        const customCertificates = await this.getCustomCertificates();

        if (customCertificates) {
            this.log.debug('Use self-signed certificates or custom certificates');
            return customCertificates;
        }

        // This really should never happen as customCertificatesContext should always be available
        this.log.error('Could not find self-signed certificate - falling back to insecure http createServer');
        return null;
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
                if (file === '/iobrokerFile.umd.js') {
                    res.status(200).setHeader('Content-Type', 'application/javascript');
                    res.send(readFileSync(`${__dirname}/../public/iobrokerFile.umd.js`));
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

            // this.readFile is sanitized
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

        this.webServer.app.use('/files/', (req: Request, res: Response): void => {
            let url: string;
            try {
                url = decodeURIComponent(req.url);
            } catch {
                // ignore
                url = req.url;
            }

            const parts = url.split('/');
            // Skip first /
            parts.shift();
            // Get ID
            const adapterName = parts.shift() || '';
            url = parts.join('/');

            // this.readFile is sanitized
            this.readFile(adapterName, url, null, (err, buffer, mimeType): void => {
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

        const portAdmin = this.usedPort(parseInt(this.config.portAdmin as string, 10) || 5680, this.config.bind);
        await this.warnAboutUsedPorts([portAdmin]);

        this.webServer.server.listen(
            portAdmin.port,
            !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
            () => {
                this.registerUsedPorts([portAdmin]);
                if (!this.config.doNotCheckPublicIP) {
                    this.checkTimeout = this.setTimeout(async () => {
                        this.checkTimeout = null;
                        try {
                            await checkPublicIP(this.config.portAdmin || 5680, 'ioBroker.web', '/iobroker_check.html');
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

        this.log.info(`http${this.config.secure ? 's' : ''} server listening on port ${this.config.portAdmin || 5680}`);

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
                        name: 'n8n-engine',
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
                            name: 'n8n-engine',
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
        const indexHtmlOriginal = readFileSync(`${distPath}/index.html`).toString();
        // The scripts are loaded below the base path of n8n: n8n replaces `/{{BASE_PATH}}/` with N8N_PATH on start,
        // so they are found on the own port of n8n and through the proxy of admin as well.
        // Scripts injected by older versions with `/assets/...` (or the old `iobrokerSelectId.umd.js`) are replaced.
        let indexHtml = indexHtmlOriginal.replace(
            /<script src="[^"]*\/assets\/(socket\.iob|iobroker|iobrokerFile\.umd|iobrokerSelectId\.umd)\.js" crossorigin><\/script>\s*/g,
            '',
        );
        // Place before first <title> tag the script
        indexHtml = indexHtml.replace(
            '<title>',
            `<script src="/{{BASE_PATH}}/assets/socket.iob.js" crossorigin></script>
        <script src="/{{BASE_PATH}}/assets/iobroker.js" crossorigin></script>
        <script src="/{{BASE_PATH}}/assets/iobrokerFile.umd.js" crossorigin></script>
        <title>`,
        );
        if (indexHtml !== indexHtmlOriginal) {
            writeFileSync(`${distPath}/index.html`, indexHtml);
        }
        let ioBrokerJs = readFileSync(`${__dirname}/../n8n-nodes-iobroker/nodes/IoBrokerNodes/iobroker.js`).toString();
        ioBrokerJs = ioBrokerJs.replace('{{PORT}}', (this.config.portAdmin || '5680').toString());
        ioBrokerJs = ioBrokerJs.replace('{{PROTOCOL}}', (this.config.secure ? 'https' : 'http').toString());
        writeFileSync(`${distPath}/assets/iobroker.js`, ioBrokerJs);

        // This page lives in `assets/` next to its scripts, so it finds them by relative URLs below every base path
        writeFileSync(
            `${distPath}/assets/iobroker.html`,
            readFileSync(`${__dirname}/../public/index.html`)
                .toString()
                .replace(/src="\/assets\//g, 'src="'),
        );

        const ioBrokerFileDialog = require.resolve('@iobroker/webcomponent-file-dialog').replace('.es.', '.umd.');
        copyFileSync(ioBrokerFileDialog, `${distPath}/assets/iobrokerFile.umd.js`);

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
        const instanceObj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
        if (!instanceObj?.native.port) {
            instanceObj!.native.port = 5678;
            await this.setForeignObjectAsync(`system.adapter.${this.namespace}`, instanceObj!);
            return;
        }

        this.log.info('N8N Adapter started');

        // Admin proxies the tab only if the instance asks for it. The flag follows the setting,
        // as n8n behind the proxy knows only the path of the proxy and not its own port anymore.
        // `adminTab.proxy` is new in admin 8.2.1 and not in the installed types yet
        const adminProxy = this.config.adminProxy !== false;
        const adminTab = instanceObj.common.adminTab as { proxy?: boolean } | undefined;
        if (adminTab && !!adminTab.proxy !== adminProxy) {
            this.log.debug(`${adminProxy ? 'Enable' : 'Disable'} the proxy of admin for the tab`);
            await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                common: { adminTab: { proxy: adminProxy } },
            } as unknown as Partial<ioBroker.InstanceObject>);
        }

        setDefaultResultOrder('ipv4first');
        setDefaultAutoSelectFamily?.(false);

        // Find out of n8n is installed in '../../node_modules' or in '../node_modules'
        const n8nDir = await this.installN8N();

        this.copyFilesToN8N(n8nDir);

        await this.startWebServer();

        let certs: Certificates | null = null;
        if (this.config.secure) {
            certs = await this.getCerts();
            // Save certificates in n8n directory for n8n
            if (certs) {
                writeFileSync(join(n8nDir, 'cert-key.pem'), certs.key);
                writeFileSync(join(n8nDir, 'cert.pem'), certs.cert);
                if (certs.ca) {
                    writeFileSync(join(n8nDir, 'cert-ca.pem'), certs.ca);
                }
            }
        }

        const env: Record<string, string> = {
            N8N_RUNNERS_ENABLED: 'true',
            N8N_RUNNERS_BROKER_PORT: (N8N_RUNNERS_BROKER_PORT + (this.instance || 0) * 10).toString(),
            N8N_USER_FOLDER,
            N8N_SECURE_COOKIE: 'false',
            PATH: process.env.PATH!,
            N8N_PORT: this.config.port?.toString() || '5678',
            // Path the browser sees n8n below. n8n itself still answers on `/`: the proxy of admin strips the prefix
            N8N_PATH: adminProxy ? this.getProxyPath() : '/',
            N8N_DIAGNOSTICS_ENABLED: 'false',
            N8N_HIRING_BANNER_ENABLED: 'false',
            N8N_MFA_ENABLED: 'false',
            N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
            N8N_LICENSE_AUTO_RENEW_ENABLED: 'false',
            // currently only 'en' is supported by n8n
            // N8N_DEFAULT_LOCALE: systemConfig?.common?.language || 'en',
            N8N_HIDE_ACTIVATION_ALERT: 'true',
            N8N_THEME: this.config.theme === 'system' ? '' : this.config.theme,
            N8N_HIDE_HIDE_GITHUB_STAR_BUTTON: 'true',
            // N8N_USER_EMAIL: this.config.email || 'test@iobroker.com',
            // N8N_USER_PASSWORD: this.config.password || 'defaultIoBrokerPassword',
            N8N_LISTEN_ADDRESS: this.config.bind || '',
            N8N_LOG_LEVEL: this.log.level === 'silly' ? 'debug' : this.log.level,
            N8N_PROTOCOL: this.config.secure ? 'https' : 'http',
            N8N_SSL_KEY: join(n8nDir, 'cert-key.pem'),
            N8N_SSL_CERT: join(n8nDir, 'cert.pem'),
            //  Smtp settings
            N8N_SMTP_HOST: this.config.smtp.host,
            N8N_SMTP_PORT: (this.config.smtp.port || 465).toString(),
            N8N_SMTP_SSL: this.config.smtp.secure ? 'true' : 'false',
            N8N_SMTP_STARTTLS: this.config.smtp.startTls ? 'true' : 'false',
            N8N_SMTP_SENDER: this.config.smtp.sender,
            N8N_SMTP_USER: this.config.smtp.auth.user,
            N8N_SMTP_PASS: this.config.smtp.auth.pass,
            // Possible values "n8n-nodes-base." + node type:
            // [
            //   "actionNetwork",
            //   "activeCampaign",
            //   "activeCampaignTrigger",
            //   "acuitySchedulingTrigger",
            //   "adalo",
            //   "affinity",
            //   "affinityTrigger",
            //   "agileCrm",
            //   "airtable",
            //   "airtableTrigger",
            //   "airtop",
            //   "aiTransform",
            //   "amqp",
            //   "amqpTrigger",
            //   "apiTemplateIo",
            //   "asana",
            //   "asanaTrigger",
            //   "automizy",
            //   "autopilot",
            //   "autopilotTrigger",
            //   "awsLambda",
            //   "awsSns",
            //   "awsSnsTrigger",
            //   "awsCertificateManager",
            //   "awsCognito",
            //   "awsComprehend",
            //   "awsDynamoDb",
            //   "awsElb",
            //   "awsIam",
            //   "awsRekognition",
            //   "awsS3",
            //   "awsSes",
            //   "awsSqs",
            //   "awsTextract",
            //   "awsTranscribe",
            //   "bambooHr",
            //   "bannerbear",
            //   "baserow",
            //   "beeminder",
            //   "bitbucketTrigger",
            //   "bitly",
            //   "bitwarden",
            //   "box",
            //   "boxTrigger",
            //   "Brandfetch",
            //   "bubble",
            //   "calTrigger",
            //   "calendlyTrigger",
            //   "chargebee",
            //   "chargebeeTrigger",
            //   "circleCi",
            //   "ciscoWebex",
            //   "ciscoWebexTrigger",
            //   "cloudflare",
            //   "clearbit",
            //   "clickUp",
            //   "clickUpTrigger",
            //   "clockify",
            //   "clockifyTrigger",
            //   "cockpit",
            //   "coda",
            //   "code",
            //   "coinGecko",
            //   "compareDatasets",
            //   "compression",
            //   "contentful",
            //   "convertKit",
            //   "convertKitTrigger",
            //   "copper",
            //   "copperTrigger",
            //   "cortex",
            //   "crateDb",
            //   "cron",
            //   "crowdDev",
            //   "crowdDevTrigger",
            //   "crypto",
            //   "customerIo",
            //   "customerIoTrigger",
            //   "dateTime",
            //   "debugHelper",
            //   "deepL",
            //   "demio",
            //   "dhl",
            //   "discord",
            //   "discourse",
            //   "disqus",
            //   "drift",
            //   "dropbox",
            //   "dropcontact",
            //   "editImage",
            //   "egoi",
            //   "elasticsearch",
            //   "elasticSecurity",
            //   "emailReadImap",
            //   "emailSend",
            //   "emelia",
            //   "emeliaTrigger",
            //   "erpNext",
            //   "errorTrigger",
            //   "evaluationTrigger",
            //   "evaluation",
            //   "eventbriteTrigger",
            //   "executeCommand",
            //   "executeWorkflow",
            //   "executeWorkflowTrigger",
            //   "executionData",
            //   "facebookGraphApi",
            //   "facebookTrigger",
            //   "facebookLeadAdsTrigger",
            //   "figmaTrigger",
            //   "filemaker",
            //   "readWriteFile",
            //   "convertToFile",
            //   "extractFromFile",
            //   "filter",
            //   "flow",
            //   "flowTrigger",
            //   "form",
            //   "formTrigger",
            //   "formIoTrigger",
            //   "formstackTrigger",
            //   "freshdesk",
            //   "freshservice",
            //   "freshworksCrm",
            //   "ftp",
            //   "function",
            //   "functionItem",
            //   "getResponse",
            //   "getResponseTrigger",
            //   "ghost",
            //   "git",
            //   "github",
            //   "githubTrigger",
            //   "gitlab",
            //   "gitlabTrigger",
            //   "gong",
            //   "googleAds",
            //   "googleAnalytics",
            //   "googleBigQuery",
            //   "googleBooks",
            //   "googleCalendar",
            //   "googleCalendarTrigger",
            //   "googleChat",
            //   "googleCloudNaturalLanguage",
            //   "googleCloudStorage",
            //   "googleContacts",
            //   "googleDocs",
            //   "googleDrive",
            //   "googleDriveTrigger",
            //   "googleFirebaseCloudFirestore",
            //   "googleFirebaseRealtimeDatabase",
            //   "gmail",
            //   "gmailTrigger",
            //   "gSuiteAdmin",
            //   "googleBusinessProfile",
            //   "googleBusinessProfileTrigger",
            //   "googlePerspective",
            //   "googleSheets",
            //   "googleSheetsTrigger",
            //   "googleSlides",
            //   "googleTasks",
            //   "googleTranslate",
            //   "youTube",
            //   "gotify",
            //   "goToWebinar",
            //   "grafana",
            //   "graphql",
            //   "grist",
            //   "gumroadTrigger",
            //   "hackerNews",
            //   "haloPSA",
            //   "harvest",
            //   "helpScout",
            //   "helpScoutTrigger",
            //   "highLevel",
            //   "homeAssistant",
            //   "htmlExtract",
            //   "html",
            //   "httpRequest",
            //   "hubspot",
            //   "hubspotTrigger",
            //   "humanticAi",
            //   "hunter",
            //   "iCal",
            //   "if",
            //   "intercom",
            //   "interval",
            //   "invoiceNinja",
            //   "invoiceNinjaTrigger",
            //   "itemLists",
            //   "iterable",
            //   "jenkins",
            //   "jinaAi",
            //   "jira",
            //   "jiraTrigger",
            //   "jotFormTrigger",
            //   "jwt",
            //   "kafka",
            //   "kafkaTrigger",
            //   "keap",
            //   "keapTrigger",
            //   "kitemaker",
            //   "koBoToolbox",
            //   "koBoToolboxTrigger",
            //   "ldap",
            //   "lemlist",
            //   "lemlistTrigger",
            //   "line",
            //   "linear",
            //   "linearTrigger",
            //   "lingvaNex",
            //   "linkedIn",
            //   "localFileTrigger",
            //   "loneScaleTrigger",
            //   "loneScale",
            //   "magento2",
            //   "mailcheck",
            //   "mailchimp",
            //   "mailchimpTrigger",
            //   "mailerLite",
            //   "mailerLiteTrigger",
            //   "mailgun",
            //   "mailjet",
            //   "mailjetTrigger",
            //   "mandrill",
            //   "manualTrigger",
            //   "markdown",
            //   "marketstack",
            //   "matrix",
            //   "mattermost",
            //   "mautic",
            //   "mauticTrigger",
            //   "medium",
            //   "merge",
            //   "messageBird",
            //   "metabase",
            //   "azureCosmosDb",
            //   "microsoftDynamicsCrm",
            //   "microsoftEntra",
            //   "microsoftExcel",
            //   "microsoftGraphSecurity",
            //   "microsoftOneDrive",
            //   "microsoftOneDriveTrigger",
            //   "microsoftOutlook",
            //   "microsoftOutlookTrigger",
            //   "microsoftSharePoint",
            //   "microsoftSql",
            //   "azureStorage",
            //   "microsoftTeams",
            //   "microsoftTeamsTrigger",
            //   "microsoftToDo",
            //   "mindee",
            //   "misp",
            //   "mistralAi",
            //   "mocean",
            //   "mondayCom",
            //   "mongoDb",
            //   "monicaCrm",
            //   "moveBinaryData",
            //   "mqtt",
            //   "mqttTrigger",
            //   "msg91",
            //   "mySql",
            //   "n8n",
            //   "n8nTrainingCustomerDatastore",
            //   "n8nTrainingCustomerMessenger",
            //   "n8nTrigger",
            //   "nasa",
            //   "netlify",
            //   "netlifyTrigger",
            //   "nextCloud",
            //   "nocoDb",
            //   "sendInBlue",
            //   "sendInBlueTrigger",
            //   "stickyNote",
            //   "noOp",
            //   "onfleet",
            //   "onfleetTrigger",
            //   "citrixAdc",
            //   "notion",
            //   "notionTrigger",
            //   "npm",
            //   "odoo",
            //   "okta",
            //   "oneSimpleApi",
            //   "openAi",
            //   "openThesaurus",
            //   "openWeatherMap",
            //   "orbit",
            //   "oura",
            //   "paddle",
            //   "pagerDuty",
            //   "payPal",
            //   "payPalTrigger",
            //   "peekalink",
            //   "perplexity",
            //   "phantombuster",
            //   "philipsHue",
            //   "pipedrive",
            //   "pipedriveTrigger",
            //   "plivo",
            //   "postBin",
            //   "postgres",
            //   "postgresTrigger",
            //   "postHog",
            //   "postmarkTrigger",
            //   "profitWell",
            //   "pushbullet",
            //   "pushcut",
            //   "pushcutTrigger",
            //   "pushover",
            //   "questDb",
            //   "quickbase",
            //   "quickbooks",
            //   "quickChart",
            //   "rabbitmq",
            //   "rabbitmqTrigger",
            //   "raindrop",
            //   "readBinaryFile",
            //   "readBinaryFiles",
            //   "readPDF",
            //   "reddit",
            //   "redis",
            //   "redisTrigger",
            //   "renameKeys",
            //   "respondToWebhook",
            //   "rocketchat",
            //   "rssFeedRead",
            //   "rssFeedReadTrigger",
            //   "rundeck",
            //   "s3",
            //   "salesforce",
            //   "salesforceTrigger",
            //   "salesmate",
            //   "scheduleTrigger",
            //   "seaTable",
            //   "seaTableTrigger",
            //   "securityScorecard",
            //   "segment",
            //   "sendGrid",
            //   "sendy",
            //   "sentryIo",
            //   "serviceNow",
            //   "set",
            //   "shopify",
            //   "shopifyTrigger",
            //   "signl4",
            //   "simulate",
            //   "simulateTrigger",
            //   "slack",
            //   "slackTrigger",
            //   "sms77",
            //   "snowflake",
            //   "splitInBatches",
            //   "splunk",
            //   "spontit",
            //   "spotify",
            //   "spreadsheetFile",
            //   "sseTrigger",
            //   "ssh",
            //   "stackby",
            //   "start",
            //   "stopAndError",
            //   "storyblok",
            //   "strapi",
            //   "strava",
            //   "stravaTrigger",
            //   "stripe",
            //   "stripeTrigger",
            //   "supabase",
            //   "surveyMonkeyTrigger",
            //   "switch",
            //   "syncroMsp",
            //   "taiga",
            //   "taigaTrigger",
            //   "tapfiliate",
            //   "telegram",
            //   "telegramTrigger",
            //   "theHiveProject",
            //   "theHiveProjectTrigger",
            //   "theHive",
            //   "theHiveTrigger",
            //   "timescaleDb",
            //   "todoist",
            //   "togglTrigger",
            //   "totp",
            //   "travisCi",
            //   "trello",
            //   "trelloTrigger",
            //   "twake",
            //   "twilio",
            //   "twilioTrigger",
            //   "twist",
            //   "twitter",
            //   "typeformTrigger",
            //   "unleashedSoftware",
            //   "uplead",
            //   "uproc",
            //   "uptimeRobot",
            //   "urlScanIo",
            //   "vero",
            //   "venafiTlsProtectCloud",
            //   "venafiTlsProtectCloudTrigger",
            //   "venafiTlsProtectDatacenter",
            //   "vonage",
            //   "wait",
            //   "webflow",
            //   "webflowTrigger",
            //   "webhook",
            //   "wekan",
            //   "whatsAppTrigger",
            //   "whatsApp",
            //   "wise",
            //   "wiseTrigger",
            //   "wooCommerce",
            //   "wooCommerceTrigger",
            //   "wordpress",
            //   "workableTrigger",
            //   "workflowTrigger",
            //   "writeBinaryFile",
            //   "wufooTrigger",
            //   "xero",
            //   "xml",
            //   "yourls",
            //   "zammad",
            //   "zendesk",
            //   "zendeskTrigger",
            //   "zohoCrm",
            //   "zoom",
            //   "zulip",
            //   "aggregate",
            //   "limit",
            //   "removeDuplicates",
            //   "splitOut",
            //   "sort",
            //   "summarize"
            // ]

            NODES_EXCLUDE: JSON.stringify(['n8n-nodes-base.telegram', 'n8n-nodes-base.telegramTrigger']),
            // N8N_DISABLED_MODULES: "insights, external-secrets",
            // N8N_SMTP_OAUTH_SERVICE_CLIENT: this.config.smtp.
            // N8N_SMTP_OAUTH_PRIVATE_KEY: this.config.smtp.

            // N8N_USER_PASSWORD:
            // N8N_USER_EMAIL
            // N8N_BASE_URL
            // N8N_LICENSE_CERT
            // N8N_LICENSE_ACTIVATION_KEY
            // N8N_LICENSE_TENANT_ID
            // N8N_PATH
            // N8N_HOST
            // N8N_HIDE_USAGE_PAGE
            // N8N_PROXY_HOPS
            // N8N_AI_ASSISTANT_BASE_URL
            // N8N_SECURE_COOKIE: 'http|https'
            // N8N_SAMESITE_COOKIE: 'strict, lax, none'
            // N8N_CACHE_MEMORY_MAX_SIZE // 3 * 1024 * 1024
            // N8N_CACHE_MEMORY_TTL // 3600 * 1000
            // N8N_CACHE_REDIS_KEY_PREFIX
            // N8N_CACHE_REDIS_TTL
            // N8N_CACHE_BACKEND
            // N8N_DEPLOYMENT_TYPE // default
            // N8N_DIAGNOSTICS_POSTHOG_API_KEY
            // N8N_DIAGNOSTICS_POSTHOG_API_HOST
            // N8N_DIAGNOSTICS_ENABLED
            // N8N_DIAGNOSTICS_CONFIG_FRONTEND
            // N8N_DIAGNOSTICS_CONFIG_BACKEND
            // N8N_LOG_LEVEL // 'error', 'warn', 'info', 'debug', 'silent'
            // N8N_EDITOR_BASE_URL // SSL Cert for HTTPS Protocol
            // N8N_AI_ENABLED
            // N8N_DISABLED_MODULES: Comma-separated list of all disabled modules
            // N8N_RESTRICT_FILE_ACCESS_TO
        };

        if (process.platform !== 'win32') {
            env.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS = 'false';
        }

        if (adminProxy) {
            // The webhooks are still called on the own port of n8n, not through admin.
            // Without it, n8n would show them with the path of the proxy, like the default `localhost` host otherwise.
            env.WEBHOOK_URL = `${env.N8N_PROTOCOL}://localhost:${env.N8N_PORT}/`;
        }

        // Print env for debug in form A=1;B=2
        // this.log.debug(
        //     `Starting n8n with env: ${Object.keys(env)
        //         .map(k => `${k}=${env[k]}`)
        //         .join(';')}`,
        // );

        // Ports opened by the n8n process: the editor and the task broker of the internal task runners
        const n8nPorts: UsedTcpPort[] = [
            this.usedPort(parseInt(env.N8N_PORT, 10) || 5678, this.config.bind),
            this.usedPort(parseInt(env.N8N_RUNNERS_BROKER_PORT, 10), '127.0.0.1'),
        ];
        await this.warnAboutUsedPorts(n8nPorts);

        // System call used for update of js-controller itself,
        // because during an installation the npm packet will be deleted too, but some files must be loaded even during the install process.
        this.n8nProcess = spawn('node', ['node_modules/n8n/bin/n8n'], { cwd: n8nDir, env });

        // n8n does not tell when it listens (depends on its log level), so the ports are claimed on start
        this.reportedN8nPorts = n8nPorts;
        this.registerUsedPorts(n8nPorts);

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
            if (!this.stopping) {
                // Not needed on stop: the host marks the entries of a stopped instance as no longer held itself
                this.freeUsedPorts(this.reportedN8nPorts);
                this.reportedN8nPorts = [];
            }
            this.killResolve?.();
        });
    }

    /**
     * Path of the n8n tab in the proxy of admin, as the browser sees it: `/proxy/n8n.0/`,
     * below the public path of admin if admin runs behind a reverse proxy with its own path
     */
    private getProxyPath(): string {
        return `/${this.config.adminPath || ''}/proxy/${this.namespace}/`.replace(/\/+/g, '/');
    }

    /**
     * Whether the ports may be reported to the registry of used resources of js-controller 8.
     * A host without the feature never answers, so every call would sit out the timeout of the adapter API.
     */
    private canReportUsedResources(): boolean {
        const api = this as unknown as UsedResourcesApi;

        if (typeof api.registerUsedResource !== 'function' || typeof api.freeUsedResource !== 'function') {
            this.log.debug('Used ports are not reported: js-controller is older than 8');
            return false;
        }
        if (typeof api.supportsFeature !== 'function' || !api.supportsFeature(USED_RESOURCES_FEATURE)) {
            this.log.debug(`Used ports are not reported: js-controller does not support "${USED_RESOURCES_FEATURE}"`);
            return false;
        }
        if ((this.common as { declareUsedResources?: boolean } | undefined)?.declareUsedResources !== true) {
            this.log.debug('Used ports are not reported: "common.declareUsedResources" is not set');
            return false;
        }

        return true;
    }

    /**
     * Entry of the registry for a port. The family is only reported for a concrete address
     *
     * @param port TCP port
     * @param bind address the socket is bound to, empty for every interface
     */
    private usedPort(port: number, bind: string | undefined): UsedTcpPort {
        const data: UsedTcpPort = { port, bind: bind || '0.0.0.0' };
        if (!WILDCARD_ADDRESSES.includes(data.bind!)) {
            data.family = isIP(data.bind!) === 6 ? 6 : 4;
        }
        return data;
    }

    /** Run a call to the registry after the previous one. Failures are logged, the ports are not worth a crash */
    private queueUsedResources(task: () => Promise<void>): void {
        this.usedResourcesQueue = this.usedResourcesQueue.then(task).catch((e: any) => {
            try {
                this.log.warn(`Could not report the used ports: ${e?.message}`);
            } catch {
                // the logger may already be gone during shutdown
            }
        });
    }

    /**
     * Ask the registry whether another instance holds one of the ports, so a failing listen can name it
     *
     * @param ports ports that are about to be opened
     */
    private async warnAboutUsedPorts(ports: UsedTcpPort[]): Promise<void> {
        const api = this as unknown as UsedResourcesApi;
        if (typeof api.checkUsedResource !== 'function' || !this.canReportUsedResources()) {
            return;
        }
        for (const data of ports) {
            try {
                const holders = await api.checkUsedResource('tcpPort', { port: data.port, bind: data.bind });
                // Entries of this instance itself, e.g. left from before a restart, are no conflict
                const others = holders
                    .map(h => h.instance)
                    .filter(id => id !== this.namespace && id !== `system.adapter.${this.namespace}`);
                if (others.length) {
                    this.log.warn(
                        `Port ${data.port} is already used by ${others.join(', ')}. The server will probably not start.`,
                    );
                }
            } catch (e) {
                this.log.debug(`Cannot check if port ${data.port} is free: ${(e as Error).message}`);
            }
        }
    }

    /**
     * Report ports this instance listens on as occupied
     *
     * @param ports ports that are open now
     */
    private registerUsedPorts(ports: UsedTcpPort[]): void {
        if (!this.canReportUsedResources()) {
            return;
        }
        for (const data of ports) {
            this.queueUsedResources(async () => {
                await (this as unknown as UsedResourcesApi).registerUsedResource!('tcpPort', data);
                this.log.debug(`Registered TCP port ${data.bind}:${data.port} as used by this instance`);
            });
        }
    }

    /**
     * Take reported ports back, e.g. when n8n exited
     *
     * @param ports ports that were reported
     */
    private freeUsedPorts(ports: UsedTcpPort[]): void {
        if (!ports.length || !this.canReportUsedResources()) {
            return;
        }
        for (const data of ports) {
            // Filtered by port and address only: the family was derived from the address
            this.queueUsedResources(async () => {
                await (this as unknown as UsedResourcesApi).freeUsedResource!('tcpPort', {
                    port: data.port,
                    bind: data.bind,
                });
                this.log.debug(`Freed TCP port ${data.bind}:${data.port}`);
            });
        }
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
