export const environment = {
  production: true,
  apiUrl:
    window.location.port === '3000'
      ? `http://${window.location.hostname}:3100/api/v1` // LXC deployment: frontend on 3000, backend on 3100
      : '/api/v1', // Standard deployment: same port
};
