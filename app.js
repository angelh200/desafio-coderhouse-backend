const cluster = require('cluster');
const { cpus } = require('os');

const PORT = parseInt(process.argv[2]) || 8080;
const modoCluster = process.argv[3] == 'CLUSTER';

if(modoCluster && cluster.isPrimary) {
    const numCPUs = cpus().length;

    console.log('Numero de procesadores:', numCPUs);
    console.log(`PID master ${process.pid}`);

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', worker => {
        console.log('Worker', worker.process.pid, 'died', new Date().toLocaleString());
        cluster.fork();
    });
} else {
    // Variables de entorno
    require('dotenv').config();

    const express =require('express');
    const compression = require('compression');
    const cookieParser = require('cookie-parser');
    const session = require('express-session');
    const MongoStore = require('connect-mongo');
    const log4js = require('log4js');


    log4js.configure({
        appenders: {
            loggerConsole: {type: 'console'},
            warnFile: {type: 'file', filename: 'warn.log'},
            errorFile: {type: 'file', filename: 'error.log'}
        },
        categories: {
            default: {appenders: ['loggerConsole'], level: 'info'},
            warnFile: {appenders: ['warnFile'], level: 'warn'},
            errorFile: {appenders: ['errorFile'], level: 'error'}
        }
    });
    
    const { Server: IOServer } = require('socket.io');
    const { Server: HttpServer } = require('http');
    
    const app = express();
    const httpServer = new HttpServer(app);
    const io = new IOServer(httpServer);
    
    // Gzip
    app.use(compression());
    
    
    // Motor de Plantillas
    const hbs = require('express-handlebars');
    
    // Importando los Models
    const Productos = require('./model/Productos');
    const Mensajes = require('./model/Mensajes');
    
    //Conexion a la base de datos de mongoose
    const mongoose = require('mongoose');
    
    main().catch(err => console.log(err));
    
    async function main() {
      await mongoose.connect(process.env.DATABASE);
    }
    
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());
    app.use(session({
        store: MongoStore.create({
            mongoUrl: process.env.DATABASE,
            mongoOptions: { useNewUrlParser: true, useUnifiedTopology: true },
            ttl: 600 // La sesion se invalida despues de 10 minutos
        }),
        secret: 'coderhouse',
        resave: false,
        saveUninitialized: false
    }));
    
    
    // Directorio publico
    app.use(express.static('public'));
    
    // Configura el motor de plantillas
    app.engine('hbs',
        hbs.engine({
            extname: '.hbs',
            defaultLayout: 'index.hbs',
            layoutsDir: __dirname + '/views/layouts/',
            partialsDir: __dirname + '/views/partials'
        })
    );
    
    //Rutas
    const webRouter = require('./routes/index');
    const testRouter = require('./routes/test');
    const sessionsRouter = require('./routes/session.router');
    const api = require('./routes/api');
    
    app.use('/', webRouter);
    app.use('/', testRouter);
    app.use('/api/sessions', sessionsRouter);
    app.use('/api', api);
    
    // Establece el directorio y el motor
    app.set('view engine', 'hbs');
    app.set('views', './views');
    
    const { normalize } = require('normalizr');
    const msgSchema = require('./msgSchema');
    // Conexiones websocket
    io.on('connection', socket => {
        console.log('Usuario Conectado');
    
        // Obtiene los productos y los envia
        Productos.getAll().then((items) => {
            // Envia los items al frontend
            socket.emit('items', items);
        });
    
        Mensajes.getAll().then((msgs) => {
            const normalizedMsgs = normalize(msgs, msgSchema);
            // Envia los mensajes del servidor
            socket.emit('msgs', msgs);
        });
    
    
        // Recibe un nuevo item y lo guarda
        socket.on('new-item', async data => {
            await Productos.save(data);
            const items = await Productos.getAll();
            io.sockets.emit('items', items);
        });
    
        // Recibe un nuevo mesaje y lo guarda
        socket.on('new-msg', async data => {
            await Mensajes.save(data);
            const msgs = await Mensajes.getAll();
            io.sockets.emit('msgs', msgs);
        });
    })

    httpServer.listen(PORT, () => {
        console.log(`Servidor activo en el puerto ${PORT}`);
    });
}
