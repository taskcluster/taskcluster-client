#!/usr/bin/env node

'use strict';

const cliff = require('cliff');
const apis = require('../apis.json');

const rows = Object
  .keys(apis)
  .reduce((rows, name) => {
    rows.push([name, apis[name].referenceUrl]);

    return rows;
  }, [
    ['Name', 'referenceUrl'],
    ['====', '============']
  ]);

console.log(cliff.stringifyRows(rows));
