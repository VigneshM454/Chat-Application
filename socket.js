const { Server } = require('socket.io');

const allowedOrigins=['https://vigneshm454-chatapp.netlify.app', 'http://localhost:5173' ]
const corsOptions={
    origin:(origin,callback)=>{
        if(allowedOrigins.includes(origin) || !origin){
            callback(null,true);
        }else{
            callback(new Error('Not allowed by cors'))
        }
    },
    methods:['GET','POST'],
    credentials:true
}

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: corsOptions
    });
    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  }
};
