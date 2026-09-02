/**
 * Configuration object to be passed to MSAL instance on creation. 
 * Application (Client) ID: 437e0ec1-9151-438f-9ddb-d86e6e25527d
 * Directory (Tenant) ID: 534253fc-dfb6-462f-b5ca-cbe81939f5ee
 */
const clientId = import.meta.env.VITE_MSAL_CLIENT_ID || "437e0ec1-9151-438f-9ddb-d86e6e25527d";
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID || "534253fc-dfb6-462f-b5ca-cbe81939f5ee";

export const msalConfig = {
    auth: {
        clientId: clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin + '/',
        postLogoutRedirectUri: window.location.origin + '/login',
        navigateToLoginRequestUrl: false,
    },
    cache: {
        cacheLocation: "localStorage",
        storeAuthStateInCookie: true,
    }
};

/**
 * Scopes to request during sign-in
 */
export const loginRequest = {
    scopes: ["openid", "profile", "email", "User.Read"]
};
