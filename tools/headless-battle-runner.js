#!/usr/bin/env node
'use strict';

try {
        require('../dist/tools/headless-battle-runner.js');
} catch (err) {
        console.error('Failed to load dist/tools/headless-battle-runner.js.');
        console.error('Have you run "npm install" or "node build" from the repository root?');
        throw err;
}
