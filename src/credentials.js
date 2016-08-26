import assert from 'assert';
import crypto from 'crypto';
import slugid from 'slugid';
import cloneDeep from 'lodash.clonedeep';
import getOptions from './options';

const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60 * 1000;

/**
 * Construct a set of temporary credentials.
 *
 * options:
 * {
 *  start:        new Date(),   // Start time of credentials (defaults to now)
 *  expiry:       new Date(),   // Credentials expiration time
 *  scopes:       ['scope'...], // Scopes granted (defaults to empty-set)
 *  clientId:     '...',  // *optional* name to create named temporary credential
 *  credentials: {        // (defaults to use global config, if available)
 *    clientId:    '...', // ClientId
 *    accessToken: '...', // AccessToken for clientId
 *  },
 * }
 *
 * Note that a named temporary credential is only valid if the issuing credentials
 * have the scope 'auth:create-client:<name>'.  This function does not check for
 * this scope, but it will be checked when the credentials are used.
 *
 * Returns an object on the form: {clientId, accessToken, certificate}
 */
export const createTemporaryCredentials = (opts) => {
  assert(opts, 'Missing required options');

  // subtract 5 min for clock drift
  const now = new Date(Date.now() - (1000 * 5 * 60));
  const options = { ...getOptions(), start: now, scopes: [], ...opts };
  const isNamed = !!options.clientId;

  assert(options.credentials, 'options.credentials is required');
  assert(options.credentials.clientId, 'options.credentials.clientId is required');

  if (isNamed) {
    assert(options.clientId !== options.credentials.clientId, 'Credential issuer must be different from the name');
  }

  assert(options.credentials.accessToken, 'options.credentials.accessToken is required');
  assert(options.credentials.certificate == null, `Temporary credentials cannot be used to make new temporary
    credentials. Ensure that options.credentials.certificate is null.`);
  assert(options.start instanceof Date, 'options.start must be a Date');
  assert(options.expiry instanceof Date, 'options.expiry must be a Date');
  assert(+options.expiry - options.start <= THIRTY_ONE_DAYS, 'Credentials cannot span more than 31 days');
  assert(Array.isArray(options.scopes), 'options.scopes must be an array');
  options.scopes.forEach(scope => assert(typeof scope === 'string', 'options.scopes must be an array of strings'));

  const certificate = {
    version: 1,
    scopes: cloneDeep(options.scopes),
    start: options.start.getTime(),
    expiry: options.expiry.getTime(),
    seed: slugid.v4() + slugid.v4(),
    signature: null,
    issuer: isNamed ? options.credentials.clientId : null
  };

  const signature = crypto.createHmac('sha256', options.credentials.accessToken);

  signature.update(`version:${certificate.version}\n`);

  if (isNamed) {
    signature.update(`clientId:${options.clientId}\n`);
    signature.update(`issuer:${options.credentials.clientId}\n`);
  }

  signature.update(`seed:${certificate.seed}\n`);
  signature.update(`start:${certificate.start}\n`);
  signature.update(`expiry:${certificate.expiry}\n`);
  signature.update(`scopes:\n`);
  signature.update(certificate.scopes.join('\n'));
  certificate.signature = signature.digest('base64');

  const accessToken = crypto
    .createHmac('sha256', options.credentials.accessToken)
    .update(certificate.seed)
    .digest('base64')
    .replace(/\+/g, '-') // Replace + with - (see RFC 4648, sec. 5)
    .replace(/\//g, '_') // Replace / with _ (see RFC 4648, sec. 5)
    .replace(/=/g,  ''); // Drop '==' padding

  return {
    clientId: isNamed ? options.clientId : options.credentials.clientId,
    accessToken,
    certificate: JSON.stringify(certificate)
  };
};

/**
 * Get information about a set of credentials.
 *
 * credentials: {
 *   clientId,
 *   accessToken,
 *   certificate,           // optional
 * }
 *
 * result: Promise for
 * {
 *    clientId: ..,         // name of the credential
 *    type: ..,             // type of credential, e.g., "temporary"
 *    active: ..,           // active (valid, not disabled, etc.)
 *    start: ..,            // validity start time (if applicable)
 *    expiry: ..,           // validity end time (if applicable)
 *    scopes: [...],        // associated scopes (if available)
 * }
 */
export const credentialInformationFactory = (Auth) => async (credentials) => {
  let issuer = credentials.clientId;
  const result = {
    clientId: issuer,
    active: true
  };

  // Distinguish permanent credentials from temporary credentials
  if (credentials.certificate) {
    let certificate = credentials.certificate;

    if (typeof certificate === 'string') {
      try {
        certificate = JSON.parse(certificate);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    result.type = 'temporary';
    result.scopes = certificate.scopes;
    result.start = new Date(certificate.start);
    result.expiry = new Date(certificate.expiry);

    if (certificate.issuer) {
      issuer = certificate.issuer;
    }
  } else {
    result.type = 'permanent';
  }

  const anonymousClient = new Auth();
  const credentialsClient = new Auth({ credentials });
  const clientLookup = anonymousClient
    .client(issuer)
    .then(client => {
      const expires = new Date(client.expires);

      if (!result.expiry || result.expiry > expires) {
        result.expiry = expires;
      }

      if (client.disabled) {
        result.active = false;
      }
    });
  const scopeLookup = credentialsClient
    .currentScopes()
    .then(response => result.scopes = response.scopes);

  await Promise.all([clientLookup, scopeLookup]);

  const now = new Date();

  if (result.start && result.start > now) {
    result.active = false
  } else if (result.expiry && result.expiry < now) {
    result.active = false;
  }

  return result;
};
