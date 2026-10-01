const fs = require('fs');
const backup = fs.readFileSync('backup.html', 'utf8');
const current = fs.readFileSync('index.html', 'utf8');

const startIdx = backup.indexOf('<div id="detail-view"');
if (startIdx === -1) { console.log('detail-view not found in backup'); process.exit(1); }

const endIdx = backup.indexOf('<div id="admin-view"', startIdx);
if (endIdx === -1) { console.log('admin-view not found after detail-view in backup'); process.exit(1); }

// we want to include the text leading up to endIdx, but maybe need to backtrack to its preceding comment.
// Let's just find the exact slice.
const detailViewContent = backup.substring(backup.lastIndexOf('<!--', startIdx), backup.lastIndexOf('<!--', endIdx));

const targetStr = '<!-- --- PROFILE VIEW PANEL --- -->';
const injectIdx = current.indexOf(targetStr);
if (injectIdx === -1) { console.log('profile-view target not found in current'); process.exit(1); }

const newContent = current.substring(0, injectIdx) + 
                   detailViewContent + 
                   current.substring(injectIdx);

fs.writeFileSync('index.html', newContent);
console.log('Successfully restored detail-view!');
