import { Adapter, type AdapterOptions, getAbsoluteDefaultDataDir } from '@iobroker/adapter-core';
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import type { N8NAdapterConfig } from './types';
import { createServer, type Server } from 'node:http';
import {copyFileSync, existsSync, mkdirSync,readdirSync, lstatSync} from 'node:fs';
import { execute } from '@oclif/core';
import { join } from "node:path";
import {readFileSync, writeFileSync} from "fs";

export class N8NAdapter extends Adapter {
    declare config: N8NAdapterConfig;
    private server: Server | undefined;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'n8n',
            unload: async cb => {
                await this.destroyN8n();
                cb?.();
            },
            stateChange: (id, state) => this.onStateChange(id, state),
            objectChange: (id, obj) => this.onObjectChange(id, obj),
            ready: async (): Promise<void> => {
                await this.main();
            },
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

    private copyNodes(): void {
        const srcDir = join(__dirname, '..', 'n8n-nodes-iobroker', 'dist');
        const dstDir = join(process.env.N8N_USER_FOLDER!, '.n8n', 'nodes', 'node_modules', 'n8n-nodes-iobroker');
        if (!existsSync(dstDir)) {
            mkdirSync(dstDir, { recursive: true });
        }
        copyFileSync(join(srcDir, '../index.js'), join(dstDir, 'index.js'));
        copyFileSync(join(srcDir, '../package.json'), join(dstDir, 'package.json'));
        if (!existsSync(`${dstDir}/dist/nodes`)) {
            mkdirSync(`${dstDir}/dist/nodes`, { recursive: true });
        }
        // Copy all files from srcDir/nodes to dstDir/dist/nodes
        const nodesDir = join(srcDir, 'nodes');
        if (existsSync(nodesDir)) {
            this.copyDirectory(nodesDir, join(dstDir, 'dist', 'nodes'));
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
        this.copyNodes();
        setDefaultResultOrder('ipv4first');
        setDefaultAutoSelectFamily?.(false);

        // Start local web server
        this.server = createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('N8N Adapter is running\n');
        });
        this.server.listen(this.config.port || 5679, () => {
            console.log(`Server is running on http://localhost:${this.config.port || 5679}`);
        });
        const dirName = require.resolve('n8n');
        let dirNameWeb = require.resolve('n8n-editor-ui');
        const parts = dirNameWeb.replace(/\\/g, '/').split('/');
        parts.pop();
        const distPath = `${parts.join('/')}/dist`;
        let indexHtml = readFileSync(`${distPath}/index.html`).toString();
        if (!indexHtml.includes('iobrokerSelectId')){
            // Place before first <title> tag the script
            indexHtml = indexHtml.replace(
                '<title>',
                `<script src="/assets/socket.iob.js"></script>
        <script src="/assets/iobrokerSelectId.umd.js"></script>
        <script src="/assets/iobroker.js"></script>
        <title>`
            );
            writeFileSync(`${parts.join('/')}/dist/index.html`, indexHtml);
        }
        copyFileSync(`${__dirname}/../n8n-nodes-iobroker/nodes/IoBrokerNodes/iobroker.js`, `${distPath}/assets/iobroker.js`);
        const ioBrokerSelectId = require.resolve('@iobroker/webcomponent-selectid-dialog').replace('.es.', '.umd.');
        copyFileSync(ioBrokerSelectId, `${distPath}/assets/iobrokerSelectId.umd.js`);

        const ioBrokerWs = require.resolve('@iobroker/ws');
        copyFileSync(ioBrokerWs.replace(/\\/g, '/').replace('/cjs/socket.io.js', '/esm/socket.io.min.js'), `${distPath}/assets/socket.iob.js`);

        await execute({ dir: dirName, args: ['start'] });
    }

    private async destroyN8n(): Promise<void> {
        this.log.info('Destroying N8N integration');
        // Clean up resources, close connections, etc.
        if (this.server) {
            await new Promise<void>(resolve => {
                this.server?.close(() => {
                    this.log.info('Server closed');
                    resolve();
                });
            })
        }
    }

    onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        this.log.debug(`State changed: ${id}, New state: ${JSON.stringify(state)}`);
        // Handle state changes here
    }

    onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {

    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new N8NAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new N8NAdapter())();
}
