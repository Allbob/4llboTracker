const fs = require('fs');
const path = 'assets/css/style.css';
let css = fs.readFileSync(path, 'utf8');

// Add new variables to root
css = css.replace(':root {', `:root {
    --panel-bg: rgba(10, 10, 10, 0.5);
    --input-bg: rgba(0, 0, 0, 0.4);
    --th-bg: rgba(0, 0, 0, 0.6);
    --shadow-heavy: rgba(0, 0, 0, 0.5);
    --title-color: #ffffff;
`);

css = css.replace(':root[data-theme="light"] {', `:root[data-theme="light"] {
    --panel-bg: rgba(255, 255, 255, 0.5);
    --input-bg: rgba(255, 255, 255, 0.7);
    --th-bg: rgba(230, 230, 230, 0.8);
    --shadow-heavy: rgba(0, 0, 0, 0.05);
    --title-color: #0f172a;
`);

// Replace hardcoded values with variables
css = css.replace(/color:\s*#fff;\s*\/\*\s*brand\s*\*\//g, 'color: var(--title-color);');
css = css.replace(/color:\s*#fff;/g, 'color: var(--title-color);'); // A bit aggressive but solves the white text issue
css = css.replace(/box-shadow: 0 0 20px rgba\(0, 0, 0, 0.5\)/g, 'box-shadow: 0 0 20px var(--shadow-heavy)');
css = css.replace(/background: rgba\(0, 0, 0, 0.4\);/g, 'background: var(--input-bg);');
css = css.replace(/background-color: rgba\(0, 0, 0, 0.4\);/g, 'background-color: var(--input-bg);');
css = css.replace(/background: rgba\(0, 0, 0, 0.6\);/g, 'background: var(--th-bg);');

// The glass panels also need to use --bg-surface properly.
// The `.glass-panel` background is currently `var(--bg-surface)` which is fine.

fs.writeFileSync(path, css);
console.log('Fixed CSS Light Mode dynamically based on variables.');
