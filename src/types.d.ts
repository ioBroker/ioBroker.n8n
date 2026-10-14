export type N8NAdapterConfig = {
    bind: string;
    port: number | string;
    portAdmin: number | string;
    secure: boolean;
    doNotCheckPublicIP: boolean;
    email: string;
    password: string;
    ttl: number;
    theme: 'dark' | 'light' | 'system';
    certPublic: string;
    certPrivate: string;
    certChained: string;
    leCollection: boolean | string;
    /** The tab in admin runs through the proxy of admin (`/proxy/n8n.0/`). Missing in old instances: on */
    adminProxy?: boolean;
    /** Public path of admin, if it runs behind a reverse proxy with its own path. Empty is `/` */
    adminPath?: string;
    smtp: {
        host: string;
        port: number | string;
        secure: boolean;
        startTls: boolean;
        sender: string;
        auth: {
            user: string;
            pass: string;
        };
    };
};
