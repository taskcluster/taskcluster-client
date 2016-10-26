import apis from '../apis.json';
import createClient from './create-client';
import {credentialInformationFactory} from './credentials';
import {DEFAULT_AGENTS} from './client';
import {createTemporaryCredentials} from './credentials';

// Exports agents, consumers can provide their own default agents and tests
// can call taskcluster.agents.http.destroy() when running locally, otherwise
// tests won't terminate (if they are configured with keepAlive)
export {DEFAULT_AGENTS as agents} from './client';
export {createTemporaryCredentials} from './credentials';
export {fromNow, fromNowJSON, slugid, parseTime} from './utils';
export {WebListener} from './weblistener';
export {PulseConnection} from './pulseconnection';
export {PulseListener} from './pulselistener';

// Instantiate clients
Object
  .keys(apis)
  .forEach((name) => {
    const api = apis[name];

    module.exports[name] = createClient(api.reference, name);
  });

module.exports.createClient = createClient;
module.exports.credentialInformation = credentialInformationFactory(module.exports.Auth);
