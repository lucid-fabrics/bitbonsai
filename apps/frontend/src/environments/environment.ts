export const environment = {
  production: false,
  version: '1.0.0', // Auto-generated from package.json
  apiUrl:
    window.location.port === '3000'
      ? `http://${window.location.hostname}:3100/api/v1` // LXC deployment: frontend on 3000, backend on 3100
      : '/api/v1', // Standard development: same port (4200 with proxy)
  licenseApiUrl: 'http://localhost:3200/api', // License API for Stripe checkout
};
