import express from 'express';
import logger from 'morgan';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import * as mediasoup from 'mediasoup';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {}
});

const peers = io.of("/mediasoup");

const mediasoupOptions = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: 
        {
          "packetization-mode"      : 1,
          "profile-level-id"        : "42e01f",
          "level-asymmetry-allowed" : 1
        },
      },
    ],
  },
};

let worker;
let router;

async function initMediasoup() {
  worker = await mediasoup.createWorker(mediasoupOptions.worker);
  router = await worker.createRouter({ mediaCodecs: mediasoupOptions.router.mediaCodecs });
  console.log('Mediasoup Worker y Router creados');
}

initMediasoup();

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  socket.on('createTransport', async (_, callback) => {
    const transport = await router.createWebRtcTransport(
      {
        listenInfos :
        [
          {
            protocol         : "udp", 
            ip               : "192.168.100.5", 
          }
        ]
      });

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });

    socket.transport = transport;

    socket.on('connectTransport', async ({ dtlsParameters }) => {
      try {
        if (!dtlsParameters || !Array.isArray(dtlsParameters.fingerprints)) {
          throw new Error('Invalid dtlsParameters');
        }
        // Asegúrate de que 'dtlsParameters' contenga los parámetros necesarios
        await socket.transport.connect({ dtlsParameters });
        console.log('Transporte conectado');
        // Enviar una respuesta al cliente para confirmar la conexión
        socket.emit('transportConnected', {
          type: 'answer',
          sdp: await socket.transport.getSdp() // Asegúrate de que 'getSdp' devuelve el SDP correcto
        });
      } catch (error) {
        console.error('Error conectando el transporte:', error);
      }
    });
    
    socket.on('produce', async ({ kind, rtpParameters }, callback) => {
      try {
        const producer = await socket.transport.produce({ kind, rtpParameters });
        console.log('Nuevo producer creado:', producer.id);
        callback({ id: producer.id });
      } catch (error) {
        console.error('Error creando el productor:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('Cliente desconectado:', socket.id);
      if (socket.transport) {
        socket.transport.close();
      }
    });
  });
});

const PORT = 3000;

app.use(logger('dev'));

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/index.html');
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
