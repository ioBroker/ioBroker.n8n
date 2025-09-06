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
