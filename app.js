require('dotenv').config()
const express=require('express');
const mongoose=require('mongoose');
const cron=require('node-cron')
//const {Server}=require('socket.io')
const cors=require('cors')
const socketCookieParser=require('socket.io-cookie-parser')
const cookieParser=require('cookie-parser');
const bodyParser=require('body-parser')
const http=require('http');
const jwt=require('jsonwebtoken')
const deleteImage=require('./utils/handleDeleteImage')
const app=express();

const {encrypt,decrypt,genEncChatKey,ENCRYPTION_KEY,encryptMessage,decryptMessage}=require('./encryptDemo')
console.log(ENCRYPTION_KEY.length)
const uri=process.env.MONGO_URI
mongoose.connect(uri)//'mongodb://127.0.0.1:27017/chatApplication
const chatModel=require('./models/chatModel')
const msgModel=require('./models/messageModel')
const hideOrDeleteMsg=require('./utils/hideOrDeleteMsg')

const socketIO=require('./socket');
const userModel = require('./models/userModel');

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
app.use(cors(corsOptions))
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
    if(accessToken||refreshToken){
        //console.log("~~~~~~~~~~~~~Either one of access or refresh token present~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
        // socket.emit('auth_err', { msg: 'Test auth error' });  // Test emission
        next();
    }else{
        // console.log('invalid')
        socket.authError='both access and refresh token not present'
        next();
        //socket.emit('auth_err',{msg:'both access and refresh token not present'})
    }
})

async function decryptMsgArr(chatId,msgArr){
    const chatData=await chatModel.findOne({_id:chatId})
    const chatKey=decrypt(chatData.chatKey,ENCRYPTION_KEY)
    msgArr.forEach(msg=>{
        msg.data=decryptMessage(msg.data,chatKey)
    })
    return msgArr;
}

async function getMsgData(socket,dbData,sender){//here only need to implement unique room
    const id=dbData._id;
    const msgArr=await msgModel.find({chatId:id,
        $or:[
            {hideUsers:{$elemMatch :{$ne:sender}}},
            {hideUsers:{$size:0}}        
        ]
    }).sort({createdAt:-1}).limit(20).exec()
    //decrypting msgs
    const msgArr2=await  decryptMsgArr(dbData._id,msgArr)
    //console.log('msgArr is ');
    //console.log(msgArr.length);
    socket.join(sender)
    //console.log('chatid is ---------------------------  '+id.toString())
    socket.join(id.toString())   //here each user joins with his chatId inorder to pass data
    //console.log(`user with id ${socket.id} joined`)
    //console.log('Rooms are++++++++++++++++++++++++')
    //console.log(socket.rooms)
    const hasMoreMsg=msgArr2.length===20
    io.to(sender).emit('recv_msgList',{arr:msgArr2.reverse(),chatId:id,hasMoreMsg:hasMoreMsg}) //to send all the prev 1msg
}

async function updateAllLastMsg(chatId,sender,recvr){//here like  lMsg1, we need lMsg2
    const lMsg1=await msgModel.find({chatId:chatId}).sort({_id:-1}).limit(1)
    //console.log('from updateApll last msg')
    const chatData=await chatModel.findOne({_id:chatId})
    //console.log(chatData)
    const chatKey=decrypt(chatData.chatKey,ENCRYPTION_KEY)
    //console.log(chatKey)
    let lMsg=lMsg1[0]
    //console.log(lMsg)
    let rData={},sData={}
    if(lMsg!==undefined && lMsg.hideUsers.includes(sender)){//check whether the sender doesnt have msg
        rData={data:lMsg.data,isFileType:lMsg.isFileType,createdAt:lMsg.createdAt};//this data is being used to update 
        lMsg.data=decryptMessage(lMsg.data,chatKey)
        io.to(recvr).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})//,lastMsg:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}
        const lMsg12=await msgModel.find({$and:[ {hideUsers:{$nin:[sender]} },{chatId:chatId}]
            }).sort({_id:-1}).limit(1);
        lMsg=lMsg12[0]
        //console.log(lMsg)
        sData=lMsg??{}//{data:'',isFileType:false,createdAt:''};//needs change, as this will also be used to update
        lMsg.data=decryptMessage(lMsg.data,chatKey)
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})
    }else if(lMsg!==undefined && lMsg.hideUsers.includes(recvr)){//check whether the recvr doesnt have msg
        sData={data:lMsg.data,isFileType:lMsg.isFileType,createdAt:lMsg.createdAt};//this data is being used to update 
        lMsg.data=decryptMessage(lMsg.data,chatKey)
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})
        const lMsg13=await msgModel.find({$and:[ {hideUsers:{$nin:[recvr]} },
            {chatId:chatId}]}).sort({_id:-1}).limit(1);
        lMsg=lMsg13[0]
        rData=lMsg??{}//{data:'',isFileType:false,createdAt:''};
        lMsg.data=decryptMessage(lMsg.data,chatKey)        
        io.to(recvr).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})

    }else{//no problem as the last msg is same for both 
        sData=rData= lMsg?lMsg:{}
        if(lMsg) lMsg.data=decryptMessage(lMsg.data,chatKey)
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}});
        if(sender!==recvr)
            io.to(recvr).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg:lMsg===undefined?{empty:""}:{data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}})

    }
    sData._id=sData._id??''
    rData._id=rData._id??''

    let chatUpdate = (sender===recvr)?
        await chatModel.updateOne({_id:chatId},{lastMsg:{
                [sender]:(sData._id).toString(), //{data:sData.data,isFileType:sData.isFileType,date:sData.createdAt}
            },}):await chatModel.updateOne({_id:chatId},{lastMsg:{
                [sender]: (sData._id).toString(), //{data:sData.data,isFileType:sData.isFileType,date:sData.createdAt},
                [recvr]: (rData._id).toString()   //{data:rData.data,isFileType:rData.isFileType,date:rData.createdAt}
        }})
    //console.log(chatUpdate)
}
io.on('connection',(socket)=>{
    if(socket.authError){
        socket.emit('auth_err',{msg:socket.authError})
        socket.disconnect()
        return;
    }//here lastMsg need to be changed for one
//here also change needed as we need to update the lastmsg
    socket.on('delete_for_me',async(data)=>{//here not only need to upload 
        const {sender,msgIdArr,chatId,recvr}=data; //the msgArr is msg to be deleted/hided
        const chatData=await chatModel.findOne({_id:chatId})
        const chatKey=decrypt(chatData.chatKey,ENCRYPTION_KEY)
        
        const msgArr=await msgModel.find({_id: {$in:msgIdArr}},{hideUsers:1,isFileType:1,data:1})
        // here update the lastMsg of one user to the last msg visible
        const lMsg1=await msgModel.find({$and:[  {_id: {$nin:msgIdArr}} ,
            {hideUsers:{$nin:[sender]} },{chatId:chatId}]}).sort({_id:-1}).limit(1);
        let lMsg=lMsg1[0];//need change
        let updatingDetails;
        let msgId='';
        if(lMsg){
            msgId=lMsg._id.toString()
            lMsg.data=decryptMessage(lMsg.data,chatKey);    
            updatingDetails=  {data:lMsg.data,isFileType:lMsg.isFileType,date:lMsg.createdAt}
        }
        io.to(sender).emit('recvNotify',{isNotify:false,sender:sender,recvr:recvr,lastMsg: lMsg===undefined?{empty:""}:updatingDetails})
        
        await chatModel.updateOne({_id:chatId},{[`lastMsg.${sender}`]:msgId })
        await hideOrDeleteMsg(msgArr,sender,chatId);
    })
//here last msg to be changed for both
    socket.on('delete_msg',async(data)=>{//delete from db, and change the data to both users
        // console.log('delete for everyOne')
        const {arr,chatId,fileDataArr,sender,recvr}=data
        //console.log(data)
        await msgModel.deleteMany({
            $and:[  {_id: {$in:arr}} ,{senderId:sender}]
        })
        // here update the lastMsg of one user to the last msg visible
        //but it will only change the data of user who is currently in that chat,
        //while using caching, we need an another event 
        io.in(chatId).emit('handle_delete_all',arr)
        io.to(recvr).emit('cacheDataDelete',{arr:arr,chatId:chatId})

        await updateAllLastMsg(chatId,sender,recvr);
        
        fileDataArr.forEach(async(dataUrl)=>{
            //   console.log('from delete for all, firebase delte img')
            const firebaseLogs=await deleteImage(dataUrl)
            //   console.log('is files delted successfully ')
            //console.log(firebaseLogs)
        })

    })
    
    //here if the edited msg is lastMsg it should be updated too
    socket.on('edit_msg',async(data)=>{
      //  console.log('edit ') // console.log(data)
        const {msgId,msgValue,chatId,sender,recvr}=data;
        const chatData=await chatModel.findOne({_id:chatId})
        const chatKey=decrypt(chatData.chatKey,ENCRYPTION_KEY)
        const encMsg=encryptMessage(msgValue,chatKey)
        msgModel.findOneAndUpdate({_id:msgId},{
        $set:{data:encMsg}  
        },{new:true}).then((updatedData)=>{
            updatedData.data=msgValue;
            //console.log(updatedData)
            io.in(chatId).emit('recv_edit_msg',updatedData)
            io.to(recvr).emit('cacheDataEdit',{data:updatedData,chatId:chatId})
            // need to send another socket event for recvr to change data in 
            updateAllLastMsg(chatId,sender,recvr)
        })
    })

    socket.on('load_more',async(data)=>{
       // console.log('load more executed <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<')
        const {sender,chatId,lastMsg}=data;
        const msgArr=await msgModel.find({chatId:chatId,createdAt:{$lt:lastMsg.createdAt},
            $or:[
                {hideUsers:{$elemMatch :{$ne:sender}}},
                {hideUsers:{$size:0}}        
            ]    
        }).sort({createdAt:-1}).limit(20).exec()
        
        const msgArr2=  await decryptMsgArr(chatId,msgArr)

        const hasMoreMsg=msgArr2.length===20//?true:false
        io.to(sender).emit('get_more',{arr:msgArr2.reverse(),hasMoreMsg:hasMoreMsg,chatId:chatId})
    })

    socket.on('send_newMsg',async(data)=>{//This is used inorder to fetch new msgs which were not in 
        const {chatId,lastMsg,sender}=data// the msg which were cached in frontend, 
        const msgLen=await msgModel.find({chatId:chatId, //I think i need to write a socketevent in  edit & delete, so as to make change to cached Data
            $or:[
                {hideUsers:{$elemMatch :{$ne:sender}}},
                {hideUsers:{$size:0}}        
            ]
        }).countDocuments()
        const msgArr=await msgModel.find({chatId:chatId,createdAt:{$gt:lastMsg.createdAt},
            $or:[
                {hideUsers:{$elemMatch :{$ne:sender}}},
                {hideUsers:{$size:0}}        
            ]
        })//.sort({createdAt:-1}).limit(20).exec()
        const msgArr2= await decryptMsgArr(chatId,msgArr)
        socket.join(sender)
        socket.join(chatId)
        const hasMoreMsg=msgLen>20?true:false
        io.to(sender).emit('recv_newMsg',{arr:msgArr2,chatId:chatId,hasMoreMsg:hasMoreMsg}) //to send all new msg which were not catched
    })
//here also change needed as we create a chatData
    socket.on('create_private_room',async(data)=>{
        //console.log('create_private_room data on socket is ')
        const {sender}=data;
        const chatData=await chatModel.findOne({
            participants:{$eq:[sender]}
        })
        //console.log(chatData)
        if(chatData===null){
            chatModel.create({ participants:[sender],createdAt:new Date(),
                chatKey: genEncChatKey(),
                lastMsg:{  [sender]:''  } //here initially i set last msg of creating user as {} 
            })//only one user
            .then(async (dbData)=>{
                console.log('creating a new private chat data ');
                socket.join((dbData._id).toString())
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
//here also change needed as we create a chatData
    socket.on('create_room',async(data)=>{//senderid, receiverid, room
        console.log('create_room,data on socket is ')
        const {sender,recvr}=data;
        const chatData=await chatModel.findOne({
            participants:{'$all': [sender,recvr] },
    //     participants:{'$size':2}
        })
        //console.log(chatData);
        if(chatData===null){
            chatModel.create({ participants:[sender,recvr], chatKey:genEncChatKey() ,createdAt:new Date(),lastMsg:{[sender]:'',[recvr]:''} })
            .then(async (dbData)=>{
                //console.log('creating a new chat data ');
                getMsgData(socket,dbData,sender)
            }).catch(err=>{
                console.log('err')
                console.log(err)
            })
        }else{
            //console.log('chat data already exist')
            getMsgData(socket,chatData,sender)
        }
    })    

    socket.on('createNotifyRoom',(data)=>{ socket.join(data)//this will create a seperate room for each user
    })

    socket.on('block_user',async(data)=>{
        const {userId,chatId,action}=data;
        let pushOrPull= action==='block'? '$push' : '$pull'
        if(userId!==undefined && chatId!==undefined){//return res.send({status:400,msg:'Invalid access '})
            const updatedChat=await chatModel.findByIdAndUpdate({_id:chatId},{  [pushOrPull]:
                    {block:userId}
                },{new:true})
            io.in(chatId).emit('block_msg',updatedChat)
        }
    })//here attention needed, as sometimes before creating a chatId, a user may try to send a msg

    socket.on('send_msg',async(Sdata)=>{
        const {sender,recvr,msgData,name}=Sdata;
        if(msgData.chatId){
            const chatData=await chatModel.findOne({_id:msgData.chatId})
            const chatKey= decrypt(chatData.chatKey,ENCRYPTION_KEY)

            msgData.data= encryptMessage(msgData.data,chatKey)
            msgModel.create(msgData).then(async(data)=>{
                data.data=decryptMessage(data.data,chatKey)
                io.to(recvr).emit('recvNotify',{isNotify:true,name:name,sender:sender,recvr:recvr,lastMsg:{data:data.data,isFileType:data.isFileType,date:data.createdAt}})
                io.to(sender).emit('recvNotify',{isNotify:true,name:name,sender:sender,recvr:recvr,lastMsg:{data:data.data,isFileType:data.isFileType,date:data.createdAt}})

                io.in(msgData.chatId).emit('recv_msg',data)
                await chatModel.updateOne({_id:Sdata.msgData.chatId},{lastMsg:{
                    [sender]: data._id, //{data:data.data, isFileType:data.isFileType,date:data.createdAt},
                    [recvr]: data._id   //{ data:data.data, isFileType:data.isFileType,date:data.createdAt}
                }})
            })  
        }

    })
    socket.on('disconnect',()=>{
        console.log('user disconnected')
    })
    //socket.emit('create_chat',{sender:userData._id,recvr:chatPerson._id})
})


async function deleteNonExistUser(){
    const deletedList=await userModel.find({isDeleted:true})
    let callAgain=false
    const chat_to_delete=[]
    const user_to_delete=[]
    for(const user of deletedList){
        const chats=await chatModel.find({participants: {'$all':[user._id]} })
        if(chats.length>0){
            for(const chat of chats){
                let msg_count= await msgModel.find({chatId:chat._id}).countDocuments()
                if(msg_count===0){
                   chat_to_delete.push(chat._id)
                   callAgain=true
                   //the chat should be deleted
                }
            }
        }else{
            user_to_delete.push(user._id)
            //the user should be deleted
        }
    }
    await chatModel.deleteMany({_id: {'$in':chat_to_delete} })
    await userModel.deleteMany({_id: {'$in':user_to_delete} })
    if(callAgain) await deleteNonExistUser()
}

cron.schedule('0 0 * * 0',deleteNonExistUser)

server.listen(3000,()=>{
    console.log('Chat app is running on port 3000');
})
//1. delete chat with no msg and where one of them is deleted ---> requires node-cron too
//2. list delted user only if there is any msg between the user to be listed and deleted user  -->ok i think
//3. delete the user if they have no chats ---> required node-cron 
//4.  change the schema of chatModel to have msgId instead of msg data, to ensure security

/*
app.use(cors({
    methods:['GET','POST'],
    credentials:true,
    origin:'http://localhost:5173'
}))
*/
/*
        if(sender!==recvr){
        }else{
            console.log('no chatId exist')
            if(sender==recvr){//private chat

            }else{//normal chat

            }
        }
*/