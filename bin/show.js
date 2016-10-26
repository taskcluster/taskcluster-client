#!/usr/bin/env node

'use strict';

const cliff = require('cliff');
const apis = require('../apis.json');

const name = process.argv[2];
const api = apis[name];

if (!api) {
  console.error(`No API named \`${name}\``);
} else {
  console.log(cliff.inspect(api));
}
