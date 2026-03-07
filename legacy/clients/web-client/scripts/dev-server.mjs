import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8'
};

createServer(async (request, response) => {
	const requestPath = request.url === '/' ? '/index.html' : new URL(request.url, `http://127.0.0.1:${port}`).pathname;
	const resolvedPath = path.join(rootDir, requestPath);

	try {
		const body = await readFile(resolvedPath);
		response.writeHead(200, {
			'Content-Type': contentTypes[path.extname(resolvedPath)] ?? 'application/octet-stream'
		});
		response.end(body);
	} catch {
		response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
		response.end('Not found');
	}
}).listen(port, '127.0.0.1', () => {
	console.log(`Mumble web client available at http://127.0.0.1:${port}`);
});
