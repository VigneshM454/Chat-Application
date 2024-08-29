require('dotenv').config()
const express=require('express');
//const expressSession =require('express-session');
//const passport=require('passport')
//const MongoStore=require('connect-mongo');
const mongoose=require('mongoose');
//const {Server}=require('socket.io')
const cors=require('cors')
const socketCookieParser=require('socket.io-cookie-parser')
const cookieParser=require('cookie-parser');
const bodyParser=require('body-parser')
const http=require('http');
const jwt=require('jsonwebtoken')
const deleteImage=require('./utils/handleDeleteImage')
const app=express();
//const uri=process.env.MONGO_URI
mongoose.connect(process.env.MONGO_URI)//'mongodb://127.0.0.1:27017/chatApplication
const chatModel=require('./models/chatModel')
const msgModel=require('./models/messageModel')
const hideOrDeleteMsg=require('./utils/hideOrDeleteMsg')

const socketIO=require('./socket')

//require('./strategies/localStrategy');//importing localstrategy
app.use(cors({
    methods:['GET','POST'],
    credentials:true,
    origin:'http://localhost:5173'
}))

app.use(express.json())
app.use(bodyParser.urlencoded({extended:true}))
app.use(cookieParser())

const server=http.createServer(app)
const io=socketIO.init(server)

app.use('/',require('./routes/userRoutes'))
app.use('/',require('./routes/forgotRoutes'))
app.use('/',require('./routes/chatRoutes'))

io.use(socketCookieParser())

io.use((socket,next)=>{
    const {accessToken,refreshToken}=socket.request.cookies
    console.log('socket token is ')
    console.log(socket.request.cookies)
   if(accessToken||refreshToken){
   // socket.emit('auth_err', { msg: 'Test auth error' });  // Test emission
    next();
   }else{
    console.log('invalid')
    socket.authError='both access and refresh token not present'
    next();
    //socket.emit('auth_err',{msg:'both access and refresh token not present'})
    console.log('sending error msg in socket')
   }
})

async function getMsgData(socket,dbData,sender){//here only need to implement unique room
    const id=dbData._id;
    console.log(id)
    console.log('from  getMsgData')
    console.log(sender)
    const msgArr=await msgModel.find({chatId:id,
        $or:[
            {hideUsers:{$elemMatch :{$ne:sender}}},
            {hideUsers:{$size:0}}        
        ]
    })
    console.log('msgArr is ');
    console.log(msgArr);
    socket.join(sender)
    await socket.join(id.toString())  

    console.log(`user with id ${socket.id} joined`)
    io.to(sender).emit('recv_msgList',{arr:msgArr,chatId:id})
}

async function updateAllLastMsg(chatId,sender,recvr){//here like  lMsg1, we need lMsg2

    const lMsg1=await msgModel.find({chatId:chatId}).sort({_id:-1}).limit(1)
    console.log('from updateApll last amsg')
    let lMsg=lMsg1[0]
    console.log(lMsg)
    let rData={},sData={}
    if(lMsg!==undefined && lMsg.hideUsers.includes(sender)){//check whether the sender doesnt have msg
        rData={data:lMsg.data,isFileType:lMsg.isFileType,createdAt:lMsg.createdAt};//this data is being used to update 
        io.to(recvr).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})//,lastMsg:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}
        const lMsg12=await msgModel.find({$and:[ {hideUsers:{$nin:[sender]} },{chatId:chatId}]
            }).sort({_id:-1}).limit(1);
        lMsg=lMsg12[0]
        console.log(lMsg)
        sData=lMsg??{}//{data:'',isFileType:false,createdAt:''};//needs change, as this will also be used to update
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})
    }else if(lMsg!==undefined && lMsg.hideUsers.includes(recvr)){//check whether the recvr doesnt have msg
        sData={data:lMsg.data,isFileType:lMsg.isFileType,createdAt:lMsg.createdAt};//this data is being used to update 
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})
        const lMsg13=await msgModel.find({$and:[ {hideUsers:{$nin:[recvr]} },
            {chatId:chatId}]}).sort({_id:-1}).limit(1);
        lMsg=lMsg13[0]
        rData=lMsg??{}//{data:'',isFileType:false,createdAt:''};
        io.to(recvr).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})

    }else{//no problem as the last msg is same for both 
        console.log('inside else')
        sData=rData=lMsg??{}
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}});
        if(sender!==recvr)
            io.to(recvr).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})

    }
    let chatUpdate = (sender===recvr)?
        await chatModel.updateOne({_id:chatId},{lastMsg:{
                [sender]:{data:sData.data,isFileType:sData.isFileType,date:sData.createdAt}
            },}):await chatModel.updateOne({_id:chatId},{lastMsg:{
                [sender]:{data:sData.data,isFileType:sData.isFileType,date:sData.createdAt},
                [recvr]:{data:rData.data,isFileType:rData.isFileType,date:rData.createdAt}
        }})
    console.log(chatUpdate)
}

io.on('connection',(socket)=>{

    if(socket.authError){
        console.log('inside socket.authError')
        socket.emit('auth_err',{msg:socket.authError})
        socket.disconnect()
        return;
    }//here lastMsg need to be changed for one
    socket.on('delete_for_me',async(data)=>{//here not only need to upload 
        console.log('delete for me ')
        const {sender,msgIdArr,chatId,recvr}=data;
        //the msgArr is msg to be deleted/hided
        const msgArr=await msgModel.find({_id: {$in:msgIdArr}},{hideUsers:1,isFileType:1,data:1})

        // here update the lastMsg of one user to the last msg visible
        const lMsg1=await msgModel.find({$and:[  {_id: {$nin:msgIdArr}} ,
            {hideUsers:{$nin:[sender]} },{chatId:chatId}]}).sort({_id:-1}).limit(1);
        let lMsg=lMsg1[0];//need change
        let updatingDetails= lMsg===undefined?{}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg: lMsg===undefined?{empty:""}:updatingDetails})
        let chatUpdate=await chatModel.updateOne({_id:chatId},{[`lastMsg.${sender}`]:updatingDetails })
        console.log('im updating only sender')
        console.log(chatUpdate)
        const hideOrDeleteLogs=await hideOrDeleteMsg(msgArr,sender,chatId);
        console.log('hideOrDeleteLogs :'+hideOrDeleteLogs)
    })
    //here last msg to be changed for both
    socket.on('delete_msg',async(data)=>{//delete from db, and change the data to both users
        console.log('delete for everyOne')
        const {arr,chatId,fileDataArr,sender,recvr}=data
        console.log(data)
        await msgModel.deleteMany({
            $and:[  {_id: {$in:arr}} ,{senderId:sender}]
        })
        // here update the lastMsg of one user to the last msg visible
        io.in(chatId).emit('handle_delete_all',arr)
        await updateAllLastMsg(chatId,sender,recvr);
        
        fileDataArr.forEach(async(dataUrl)=>{
            console.log('from delete for all, firebase delte img')
            const firebaseLogs=await deleteImage(dataUrl)
            console.log('is files delted successfully ')
            console.log(firebaseLogs)
        })

    })
    //here if the edited msg is lastMsg it should be updated too
    socket.on('edit_msg',async(data)=>{
        console.log('edit ')
        console.log(data)
        const {msgId,msgValue,chatId,sender,recvr}=data;
        msgModel.findOneAndUpdate({_id:msgId},{
        $set:{data:msgValue}  
        },{new:true}).then((updatedData)=>{
            console.log(updatedData)
            io.in(chatId).emit('recv_edit_msg',updatedData)
        })
        await updateAllLastMsg(chatId,sender,recvr)
    })

    socket.on('create_private_room',async(data)=>{
        console.log('create_private_room data on socket is ')
        const {sender}=data;
        const chatData=await chatModel.findOne({
        participants:{$eq:[sender]}
        })
        console.log(chatData)
        if(chatData===null){
            chatModel.create({ participants:[sender],createdAt:new Date(),
                lastMsg:{  [sender]:{}  } //here initially i set last msg of creating user as {} 
            })//only one user
            .then(async (dbData)=>{
                console.log('creating a new private chat data ');
                getMsgData(socket,dbData,sender)
            }).catch(err=>{
                console.log('err')
                console.log(err)
            })
        }else{
            console.log('private chat data already exist')
            getMsgData(socket,chatData,sender)
        }
    })
    socket.on('create_room',async(data)=>{//senderid, receiverid, room
        console.log('create_room,data on socket is ')
        console.log(data);
        const {sender,recvr}=data;
        console.log('sender id is '+sender)
        console.log('recvr id is '+recvr)
        const chatData=await chatModel.findOne({
            participants:{'$all': [sender,recvr] },
    //     participants:{'$size':2}
        })
        console.log(chatData);
        if(chatData===null){
            chatModel.create({ participants:[sender,recvr],createdAt:new Date(),lastMsg:{[sender]:{},[recvr]:{}} })
            .then(async (dbData)=>{
                console.log('creating a new chat data ');
                getMsgData(socket,dbData,sender)
            }).catch(err=>{
                console.log('err')
                console.log(err)
            })
        }else{
            console.log('chat data already exist')
            getMsgData(socket,chatData,sender)
        }
    })    

    socket.on('createNotifyRoom',(data)=>{ socket.join(data)//this will create a seperate room for each user
    })

    socket.on('block_user',async(data)=>{
        console.log('entered block user')
        console.log(data)
        const {userId,chatId,action}=data;
        let pushOrPull= action==='block'? '$push' : '$pull'
        if(userId!==undefined && chatId!==undefined){//return res.send({status:400,msg:'Invalid access '})
            const updatedChat=await chatModel.findByIdAndUpdate({_id:chatId},{  [pushOrPull]:
                    {block:userId}
                },{new:true})
            console.log(updatedChat)
            io.in(chatId).emit('block_msg',updatedChat)
        }
    })//here as usuall update last msg
    socket.on('send_msg',async(Sdata)=>{
        const {sender,recvr,msgData,name}=Sdata;
        console.log('in send_msg');
        console.log(Sdata)
        console.log('response send')
        msgModel.create(msgData).then(async(data)=>{
            console.log('data inserted')//console.log(data)
            //if(sender!==recvr){
                io.to(recvr).emit('recvNotify',{isNotify:true,name:name,sender:sender,recvr:recvr,lastMsg:{data:data.data,isFileType:data.isFileType,date:data.createdAt}})
                io.to(sender).emit('recvNotify',{isNotify:true,name:name,sender:sender,recvr:recvr,lastMsg:{data:data.data,isFileType:data.isFileType,date:data.createdAt}})
        // }
            io.in(Sdata.msgData.chatId).emit('recv_msg',data)
        // io.in(Sdata.msgData.chatId).emit('recv_lastMsg',{data:data.data,user1:sender,user2:recvr})
            await chatModel.updateOne({_id:Sdata.msgData.chatId},{lastMsg:{
                [sender]:{data:data.data, isFileType:data.isFileType,date:data.createdAt},
                [recvr]:{ data:data.data, isFileType:data.isFileType,date:data.createdAt}
            }})
            // io.in(msgData.chatId).emit('recv_msg',msgData)
        })  
    })
    socket.on('disconnect',()=>{
        console.log('user disconnected')
    })
    //socket.emit('create_chat',{sender:userData._id,recvr:chatPerson._id})
})


server.listen(3000,()=>{
    console.log('Chat app is running on port 3000');
})

/*
const io=new Server(server,{
    cors:{
        methods:['GET','POST'],
        credentials:true,
        origin:'http://localhost:5173'    
    }
})
*/

            //io.to(sender).emit('recvNotify',{msg:lMsg.data,isNotify:false,sender:sender,recvr:recvr,lastMsgType:lMsg.isFileType});
       
        //emitNotify(sender,sData.data,sData.isFileType)
        //sender!==recvr? emitNotify(recvr,rData.data,rData.isFileType) :console.log('do nothing')
        //io.to(recvr).emit('recvNotify',{msg:lMsg.data,isNotify:false,sender:sender,recvr:recvr,lastMsgType:lMsg.isFileType})
        //io.to(sender).emit('recvNotify',{msg:lMsg.data,isNotify:false,sender:sender,recvr:recvr,lastMsgType:lMsg.isFileType})
            /*
        if(lMsg.hideUsers.includes(recvr)){//check whether the recvr has that msg
            const lMsg13=await msgModel.find({$and:[ {_id: {$nin:msgIdArr}}, {hideUsers:{$nin:[recvr]} },
                {chatId:chatId}]}).sort({_id:-1}).limit(1);
            lMsg=lMsg13[0]
            io.to(recvr).emit('recvNotify',{msg:lMsg.data,isNotify:false,sender:sender,recvr:recvr,lastMsgType:data.isFileType})
            let chatUpdate=await chatModel.updateOne({_id:chatId},{[`lastMsg.${recvr}`]:lMsg.data})
            console.log(chatUpdate)
        }*/