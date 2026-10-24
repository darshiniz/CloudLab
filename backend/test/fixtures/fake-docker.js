#!/usr/bin/env node
// Stand-in for the docker CLI: records every call (with DOCKER_HOST) as a JSON line and answers like Docker would.
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify({ args, host: process.env.DOCKER_HOST || null }) + '\n');
const [cmd, sub] = args;
if (cmd === 'network' && sub === 'inspect') { console.error('Error: No such network: ' + args[2]); process.exit(1); }
if (cmd === 'image' && sub === 'inspect') { console.error('Error: No such image'); process.exit(1); }
if (cmd === 'create') { console.log('0123456789abcdef0123456789abcdef'); process.exit(0); }
if (cmd === 'inspect' && args[1] === 'gone') { console.error('Error: No such object: gone'); process.exit(1); }
if (cmd === 'info') { console.log('2|4025000000'); process.exit(0); }
if (cmd === 'stats') { console.log('abc123def456|cl-env_aaaaaaaaaa|50.00%|25.00%|256MiB / 1GiB\nzzz|other-container|90%|90%|1MiB / 1GiB'); process.exit(0); }
if (cmd === 'ps') { console.log('0123456789ab|cl-env_aaaaaaaaaa|running|env_aaaaaaaaaa'); process.exit(0); }
if (cmd === 'version') { console.log('27.0.0'); process.exit(0); }
process.exit(0);
