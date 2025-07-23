import fs from 'fs';
import axios from 'axios';
import chalk from 'chalk';
import Table from 'cli-table3';
import path from 'path';

// Configuración por defecto
const DEFAULT_CONFIG = {
    collectionPath: './collection.json',
    users: 10,
    repetitions: 1,
    delayMsBetweenUsers: 10
};

// Lee configuración desde archivo o usa valores por defecto
function loadConfig() {
    const configPath = './config.json';
    
    try {
        if (fs.existsSync(configPath)) {
            const configFile = fs.readFileSync(configPath, 'utf-8');
            const userConfig = JSON.parse(configFile);
            console.log(chalk.blue('📋 Configuración cargada desde config.json'));
            return { ...DEFAULT_CONFIG, ...userConfig };
        }
    } catch (error) {
        console.log(chalk.yellow('⚠️  Error leyendo config.json, usando valores por defecto'));
    }
    
    console.log(chalk.gray('📋 Usando configuración por defecto'));
    return DEFAULT_CONFIG;
}

const CONFIG = loadConfig();

// Lee archivo de colección Postman
function loadCollection(pathToFile) {
    const raw = fs.readFileSync(pathToFile, 'utf-8');
    const json = JSON.parse(raw);
    return json.item || [];
}

// Ejecuta una petición individual
async function runRequest(item) {
    const req = item.request;
    const url = typeof req.url === 'string' ? req.url : req.url.raw;
    const method = req.method || 'GET';
    const headers = (req.header || []).reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {});
    const body = req.body?.raw || null;

    const start = Date.now();
    try {
        const response = await axios({
            method,
            url,
            headers,
            data: body,
            validateStatus: () => true,
            timeout: 10000
        });
        const duration = Date.now() - start;
        return {
            name: item.name,
            status: response.status,
            duration,
            success: response.status >= 200 && response.status < 400
        };
    } catch (err) {
        return {
            name: item.name,
            status: 0,
            duration: Date.now() - start,
            success: false
        };
    }
}

// Ejecuta la simulación completa
async function simulateLoad(config) {
    const collection = loadCollection(config.collectionPath);
    const results = [];
    const totalRequests = config.users * config.repetitions * collection.length;
    let completedRequests = 0;

    console.log(chalk.blue(`🚀 Ejecutando test de carga con ${config.users} usuarios x ${config.repetitions} repeticiones...`));
    console.log(chalk.yellow(`📊 Total de peticiones a realizar: ${totalRequests}\n`));

    // Función para actualizar el progreso
    function updateProgress() {
        const percentage = Math.round((completedRequests / totalRequests) * 100);
        const completed = '█'.repeat(Math.floor(percentage / 2));
        const remaining = '░'.repeat(50 - Math.floor(percentage / 2));
        const progressBar = `[${completed}${remaining}]`;
        
        process.stdout.write(`\r${chalk.cyan('Progreso:')} ${progressBar} ${percentage}% (${completedRequests}/${totalRequests}) ${chalk.green('✓')}`);
        
        if (completedRequests === totalRequests) {
            console.log('\n'); // Nueva línea al completar
        }
    }

    const tasks = Array.from({ length: config.users }).map((_, i) => new Promise((resolve) => {
        setTimeout(async () => {
            for (let r = 0; r < config.repetitions; r++) {
                for (const item of collection) {
                    const result = await runRequest(item);
                    results.push(result);
                    completedRequests++;
                    updateProgress();
                }
            }
            resolve();
        }, i * config.delayMsBetweenUsers);
    }));

    await Promise.all(tasks);

    console.log(chalk.green('\n✅ Test completado!\n'));
    showSummary(results);
}

// Muestra resumen en tabla
function showSummary(results) {
    const summary = {};

    for (const r of results) {
        if (!summary[r.name]) {
            summary[r.name] = { times: [], errors: 0 };
        }
        summary[r.name].times.push(r.duration);
        if (!r.success) summary[r.name].errors++;
    }

    const table = new Table({ head: ['Petición', 'Total', 'Errores', 'Promedio (ms)', 'Máx', 'Mín', 'P95', 'Éxito (%)'] });

    for (const [name, data] of Object.entries(summary)) {
        const count = data.times.length;
        const total = data.times.reduce((a, b) => a + b, 0);
        const avg = Math.round(total / count);
        const max = Math.max(...data.times);
        const min = Math.min(...data.times);
        const sorted = [...data.times].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(0.95 * sorted.length)];
        const successRate = Math.round(((count - data.errors) / count) * 100);
        table.push([
            name,
            count,
            data.errors,
            avg,
            max,
            min,
            p95,
            chalk[successRate < 80 ? 'red' : 'green'](`${successRate}%`)
        ]);
    }

    console.log(table.toString());
    
    // Estadísticas globales
    const totalRequests = results.length;
    const totalErrors = Object.values(summary).reduce((acc, data) => acc + data.errors, 0);
    const globalSuccessRate = Math.round(((totalRequests - totalErrors) / totalRequests) * 100);
    const allTimes = results.map(r => r.duration);
    const globalAvgTime = Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length);
    
    console.log(chalk.blue.bold('\n🎯 ESTADÍSTICAS GLOBALES'));
    console.log(`Total de peticiones: ${chalk.yellow(totalRequests)}`);
    console.log(`Errores totales: ${chalk.red(totalErrors)}`);
    console.log(`Tasa de éxito global: ${chalk.green(globalSuccessRate + '%')}`);
    console.log(`Tiempo promedio global: ${chalk.cyan(globalAvgTime + 'ms')}`);
}

// Función para pausar al final (simple)
function waitForKey() {
    console.log(chalk.gray('\n📋 Presiona cualquier tecla para salir...'));
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.exit(0);
    });
}

// Función principal
async function main() {
    try {
        await simulateLoad(CONFIG);
        waitForKey();
    } catch (error) {
        console.error(chalk.red(`❌ Error: ${error.message}`));
        waitForKey();
    }
}

main();
