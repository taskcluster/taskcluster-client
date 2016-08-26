#!/usr/bin/env node

'use strict';

const parse = require('json-schema-to-markdown');
const fs = require('fs');
const path = require('path');
const apis = require('../apis.json');
const tags = require('common-tags');

const renderMethods = (stream, reference, name) => {
  const methods = reference.entries.filter(entry => entry.type === 'function');

  if (!methods.length) {
    return;
  }

  const instanceName = `${name[0].toLowerCase()}${name.substr(1)}`;

  stream.write(tags.stripIndents`
    ## ${name} Client
      
    \`\`\`js
    // Create ${name} client instance with default baseUrl:
    // ${reference.baseUrl}
    
    const ${instanceName} = new taskcluster.${name}(options);
    \`\`\`
    
    ## Methods in ${name} Client
    
    ${
      methods
        .map(entry => {
          const args = entry.args.slice();
          const commentArgs = entry.args.slice();
          const hasOptions = entry.query && entry.query.length;
          
          if (entry.input) {
            args.push('payload');
            commentArgs.push('payload');
          }
          
          if (hasOptions) {
            commentArgs.push('[options]');
          }
    
          return tags.stripIndents`
            \`\`\`js
            // ${instanceName}.${entry.name} :: ${
              commentArgs.length === 1 ?
                commentArgs[0] :
                `(${commentArgs.join(' -> ')})`
            } -> ${entry.output ? 'Promise Result' : 'Promise Nothing'}
            ${instanceName}.${entry.name}(${args.join(', ')})
            ${hasOptions ? `${instanceName}.${entry.name}(${args.concat('options').join(', ')})` : ''}
            \`\`\`
          `;  
        })
        .join('\n\n')
    }
  `);
};

const renderExchanges = (stream, reference, name) => {
  const exchanges = reference.entries.filter(entry => entry.type === 'topic-exchange');

  if (!exchanges.length) {
    return;
  }

  const instanceName = `${name[0].toLowerCase()}${name.substr(1)}`;

  stream.write(tags.stripIndents`
    ## ${name} Client
    
    \`\`\`js
    // Create ${name} client instance with default exchangePrefix:
    // ${reference.exchangePrefix}
    
    const ${instanceName} = new taskcluster.${name}(options);
    \`\`\`
    
    ## Exchanges in ${name} Client
    
    ${
      exchanges
        .map(entry => tags.stripIndents`
          \`\`\`js
          // ${instanceName}.${entry.name} :: routingKeyPattern -> Promise BindingInfo
          ${instanceName}.${entry.name}(routingKeyPattern)
           \`\`\`
        `)
        .join('\n\n')
    }
  `);
};

const docs = Object
  .keys(apis)
  .map(name => {
    const reference = apis[name].reference;
    const filename = `${name.toLowerCase()}.md`;
    const stream = fs.createWriteStream(path.join(__dirname, `../docs/${filename}`));

    console.log(`Generating docs for ${name}`);

    stream.write(parse(reference));
    stream.write('\n\n');
    renderMethods(stream, reference, name);
    stream.write('\n\n');
    renderExchanges(stream, reference, name);

    return {
      name,
      filename
    };
  });

const README = `# Documentation

This documentation in this directory is automatically generated from the API entries
defined in [apis.json](../apis.json). Detailed documentation with description, payload,
and result format details is available on [docs.taskcluster.net](http://docs.taskcluster.net).

On the [documentation site](http://docs.taskcluster.net) entries often have a
_signature_; you'll find that it corresponds with the signatures below. Notice that all
the methods return a \`Promise\`. A method marked \`Promise Result\` a Promise that
resolves with the API result. A method marked with \`Promise Nothing\` will also return a
promise but has no resulting value from the API to resolve. Remember to \`catch\` any errors
that may be rejected from a Promise.

${docs.map(doc => `- [${doc.name}](${doc.filename})`).join('\n')}
`;

console.log('\nUpdating docs/README.md');
fs.writeFileSync(path.join(__dirname, '../docs/README.md'), README);
