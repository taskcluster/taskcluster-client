let customOptions = null;

/**
 * Update default configuration
 *
 * Example: `Client.config({credentials: {...}});`
 */
export const config = (options) => customOptions = options;

export default () => ({
  credentials: {
    clientId: process.env.TASKCLUSTER_CLIENT_ID,
    accessToken: process.env.TASKCLUSTER_ACCESS_TOKEN,
    certificate: process.env.TASKCLUSTER_CERTIFICATE
  },
  // Request time out (defaults to 30 seconds)
  timeout: 30 * 1000,
    // Max number of request retries
    retries: 5,
  // Multiplier for computation of retry delay: 2 ^ retry * delayFactor,
  // 100 ms is solid for servers, and 500ms - 1s is suitable for background
  // processes
  delayFactor: 100,
  // Randomization factor added as.
  // delay = delay * random([1 - randomizationFactor; 1 + randomizationFactor])
  randomizationFactor: 0.25,
  // Maximum retry delay (defaults to 30 seconds)
  maxDelay: 30 * 1000,
  ...customOptions
});
