import fs from 'fs';
const path = 'public/app.js';
let s = fs.readFileSync(path, 'utf8');
s = s.split('<motion').join('<' + 'div');
s = s.split('</motion>').join('</' + 'div>');
fs.writeFileSync(path, s);
console.log('done', fs.readFileSync(path,'utf8').includes('<motion'));
