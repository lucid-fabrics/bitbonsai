export const environment = {
  production: false,
  apiUrl:
    window.location.port === '3000'
      ? `http://${window.location.hostname}:3100/api/v1` // LXC deployment: frontend on 3000, backend on 3100
      : '/api/v1', // Standard development: same port (4200 with proxy)
};
