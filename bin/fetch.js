#!/usr/bin/env node

'use strict';

const got = require('got');
const stringify = require('json-stable-stringify');
const path = require('path');
const fs = require('fs');

const MANIFEST_URL = 'http://references.taskcluster.net/manifest.json';
const fetch = (url) => got(url, { json: true });

console.log(`Fetching manifest reference from ${MANIFEST_URL}\n`);

fetch(MANIFEST_URL)
  .then((response) => {
    const body = response.body;
    const apis = {};
    const promises = Object
      .keys(body)
      .map(name => {
        console.log(`Fetching ${name} reference`);

        return fetch(body[name])
          .then(response => {
            console.log('Updated', name);

            apis[name] = {
              referenceUrl: body[name],
              reference: response.body
            };
          });
    });

    return Promise
      .all(promises)
      .then(() => apis);
  })
  .then(apis => fs.writeFileSync(path.join(__dirname, '../apis.json'), stringify(apis, { space: 2 }) + '\n'))
  .then(() => console.log('\nUpdated API reference written to apis.json'))
  .catch(err => {
    console.error('Failed to update apis.json');
    console.error(err.stack || err);
  });
