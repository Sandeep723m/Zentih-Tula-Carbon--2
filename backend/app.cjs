// cPanel / Passenger startup file: Passenger loads CommonJS, the server is an ES module.
// Run from this folder so private/.env and public/ resolve however Passenger starts the process.
process.chdir(__dirname)
import('./dist/src/server.js')
