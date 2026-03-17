export const environment = {
  production: false,
  version: '1.0.0', // Auto-generated from package.json
  apiUrl: (() => {
    const port = window.location.port;
    // LXC deployment: frontend on 3000, backend on 3100
    if (port === '3000') {
      return `http://${window.location.hostname}:3100/api/v1`;
    }
    // Unraid dev deployment: frontend on 4210, backend on 3100
    if (port === '4210' || port === '4200') {
      return `http://${window.location.hostname}:3100/api/v1`;
    }
    // Standard development with proxy (same port)
    return '/api/v1';
  })(),
  licenseApiUrl: 'http://localhost:3200/api', // License API for Stripe checkout
};
