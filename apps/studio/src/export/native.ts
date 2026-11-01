/**
 * Wrapper projects that turn the exported web game (in `www/`) into a desktop or mobile app.
 * They are plain text files, so the studio never needs native toolchains — the user runs the
 * wrapper's own build (electron-builder, Capacitor/Xcode/Android Studio, Tauri) on their machine.
 */

export type NativeTarget = 'electron' | 'capacitor' | 'tauri';

export const NATIVE_TARGETS: Record<NativeTarget, { label: string; description: string }> = {
  electron: { label: 'Desktop app (Electron)', description: 'Windows, macOS and Linux installers via electron-builder.' },
  capacitor: { label: 'Mobile app (Capacitor)', description: 'Android and iOS projects.' },
  tauri: { label: 'Desktop app (Tauri)', description: 'Small native desktop builds (needs Rust).' },
};

export interface WrapperFile {
  path: string;
  content: string;
}

/** Folder inside the ZIP that holds the web game. */
export const WEB_ROOT = 'www';

export const packageNameFor = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';

/** Reverse-DNS id that is valid for Android, iOS and Tauri (letters/digits, segments start with a letter). */
export const appIdFor = (name: string): string => `app.bazisazi.${packageNameFor(name).replace(/-/g, '') || 'game'}`.replace(/\.(\d)/g, '.g$1');

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export function nativeWrapperFiles(target: NativeTarget, gameName: string): WrapperFile[] {
  const pkg = packageNameFor(gameName);
  const id = appIdFor(gameName);
  const title = gameName.trim() || 'Game';
  switch (target) {
    case 'electron':
      return [
        {
          path: 'package.json',
          content: json({
            name: pkg,
            productName: title,
            version: '1.0.0',
            description: `${title} — exported from Bazi-Sazi`,
            main: 'main.js',
            scripts: { start: 'electron .', dist: 'electron-builder' },
            devDependencies: { electron: '^33.0.0', 'electron-builder': '^25.0.0' },
            build: { appId: id, productName: title, files: ['main.js', `${WEB_ROOT}/**/*`], mac: { category: 'public.app-category.games' }, linux: { target: 'AppImage', category: 'Game' } },
          }),
        },
        {
          path: 'main.js',
          content: `// Serves the game from a custom app:// origin so models and audio load (file:// blocks fetch).
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, ${JSON.stringify(WEB_ROOT)});
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    title: ${JSON.stringify(title)},
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  win.loadURL('app://game/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const file = path.normalize(path.join(root, decodeURIComponent(new URL(request.url).pathname)));
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
`,
        },
        { path: 'README.md', content: `# ${title} (Electron)\n\n1. Install Node.js 20+.\n2. \`npm install\`\n3. \`npm start\` to try it, \`npm run dist\` to build an installer for this OS.\n\nPress F11 for full screen.\n` },
      ];
    case 'capacitor':
      return [
        {
          path: 'package.json',
          content: json({
            name: pkg,
            version: '1.0.0',
            private: true,
            scripts: { sync: 'cap sync', android: 'cap open android', ios: 'cap open ios' },
            dependencies: { '@capacitor/core': '^7.0.0', '@capacitor/android': '^7.0.0', '@capacitor/ios': '^7.0.0' },
            devDependencies: { '@capacitor/cli': '^7.0.0' },
          }),
        },
        { path: 'capacitor.config.json', content: json({ appId: id, appName: title, webDir: WEB_ROOT, server: { androidScheme: 'https' }, backgroundColor: '#000000' }) },
        {
          path: 'README.md',
          content: `# ${title} (Capacitor)\n\n1. \`npm install\`\n2. \`npx cap add android\` and/or \`npx cap add ios\` (once)\n3. \`npm run sync\` after changing anything in \`www/\`\n4. \`npm run android\` / \`npm run ios\` opens Android Studio / Xcode to run or publish.\n`,
        },
      ];
    case 'tauri':
      return [
        {
          path: 'package.json',
          content: json({ name: pkg, version: '1.0.0', private: true, scripts: { dev: 'tauri dev', build: 'tauri build' }, devDependencies: { '@tauri-apps/cli': '^2.0.0' } }),
        },
        {
          path: 'src-tauri/tauri.conf.json',
          content: json({
            $schema: 'https://schema.tauri.app/config/2',
            productName: title,
            version: '1.0.0',
            identifier: id,
            build: { frontendDist: `../${WEB_ROOT}` },
            app: { windows: [{ title, width: 1280, height: 720, resizable: true }], security: { csp: null } },
            bundle: { active: true, targets: 'all' },
          }),
        },
        { path: 'src-tauri/Cargo.toml', content: `[package]\nname = ${JSON.stringify(pkg)}\nversion = "1.0.0"\nedition = "2021"\n\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n\n[dependencies]\ntauri = { version = "2", features = [] }\n` },
        { path: 'src-tauri/build.rs', content: 'fn main() {\n    tauri_build::build()\n}\n' },
        { path: 'src-tauri/src/main.rs', content: '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nfn main() {\n    tauri::Builder::default()\n        .run(tauri::generate_context!())\n        .expect("error while running the app");\n}\n' },
        {
          path: 'README.md',
          content: `# ${title} (Tauri)\n\n1. Install Rust (https://rustup.rs) and Node.js.\n2. \`npm install\`\n3. \`npx tauri icon path/to/icon.png\` (once; creates the app icons)\n4. \`npm run dev\` to try it, \`npm run build\` for an installer.\n`,
        },
      ];
  }
}
