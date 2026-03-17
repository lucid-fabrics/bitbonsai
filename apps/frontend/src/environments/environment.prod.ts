export const environment = {
  production: true,
  version: '1.0.0', // Auto-generated from package.json
  apiUrl:
    window.location.port === '3000'
      ? `http://${window.location.hostname}:3100/api/v1` // LXC deployment: frontend on 3000, backend on 3100
      : '/api/v1', // Standard deployment: same port
  licenseApiUrl: 'https://api.bitbonsai.app/api', // License API for Stripe checkout
};
