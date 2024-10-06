const express=require('express')
//const userModel=require('../models/userModel')
const chatModel=require('../models/chatModel')
const msgModel=require('../models/messageModel')
const chatRouter=express.Router();
const {verifyToken}=require('../auth/userAuth')
//const deleteImage=require('../utils/handleDeleteImage')
const hideOrDeleteMsg=require('../utils/hideOrDeleteMsg')
const socketIO=require('../socket')
const {encrypt,decrypt,ENCRYPTION_KEY,encryptMessage,decryptMessage}=require('../encryptDemo')
//const socket=socketIO.getSocket()
//const io=socketIO.getIO()

chatRouter.post('/clear-chat',verifyToken,async(req,res,next)=>{
    const {userId,chatId,recvr}=req.body;
    if(userId===undefined||chatId===undefined)return res.send({status:400,msg:'Invalid access'})
    const msgArr=await msgModel.find({chatId:chatId,
        $or:[
            {hideUsers:{$elemMatch :{$ne:userId}}},
            {hideUsers:{$size:0}}        
        ]
    });
    const hideOrDeleteLogs=await hideOrDeleteMsg(msgArr,userId,chatId);
    const updateChat=await chatModel.findOneAndUpdate({_id:chatId},{[`lastMsg.${userId}`]:''},{new:true})
    const io=socketIO.getIO()
    //sendUpdate({TO:userId,msg:'',sender:userId,recvr:recvr,lastMsgType:false}) //this is ok for only one user, incase of 2 the recever is dan
    io.to(userId).emit('recvNotify',{isNotify:false,sender:userId,recvr:recvr,lastMsg:{empty:""}})

    hideOrDeleteLogs ? res.send({status:200,msg:'Chat cleared successfully !'})
        :res.send({status:300,msg:'Some errors occured in clearing the chats'})
})

chatRouter.post('/delete-chat',verifyToken,async(req,res,next)=>{
    const {chatId,sender,recvr}=req.body
    if(!chatId || !sender || !recvr) return res.send({status:500,msg:'Invalid request'})
    const chat=await chatModel.findOne({_id:chatId,participants:{'$all':[sender,recvr]} })
    if(!chat) return res.send({status:404,msg:'No such chatId exist'})
    //if chat exist
    await chatModel.findByIdAndDelete(chatId)
    await msgModel.deleteMany({chatId:chatId})
    return res.send({status:200,msg:'Chat deleted successfully'})
    
})

chatRouter.post('/mute_user',verifyToken,async(req,res,next)=>{
    const {userId,chatId,action}=req.body;
    if(userId===undefined||chatId===undefined)return res.send({status:400,msg:'Invalid access '})
    let pushOrPull= action==='mute'? '$push' : '$pull'

    const updatedChat=await chatModel.findByIdAndUpdate({_id:chatId},{[pushOrPull]:
        {mute:userId} 
    },{new:true})
    res.send({status:200,msg:action==='mute'?'Mutted successfully':"Unmutted successfully",data:updatedChat})
})

chatRouter.post('/search_msg',verifyToken,async(req,res,next)=>{
    const {searchVal,chatIdArr,userId}=req.body;
    if(searchVal===''||chatIdArr.length<1) return res.send({status:400,msg:'Some Fields are missing'})

    const chatsInvolved=await chatModel.find({participants:{'$all':[userId]}},{chatKey:1,participants:1})

    chatsInvolved.map(chat=> chat.chatKey=decrypt(chat.chatKey,ENCRYPTION_KEY))

    const msgTobeSearch=await msgModel.find({$and :[
        {chatId: {$in:chatIdArr} },{isFileType:false}
    ]})

    msgTobeSearch.map(msg=>{
        var chatKey=chatsInvolved.filter(chats=>(chats._id).toString()==(msg.chatId).toString())[0].chatKey
        msg.data=decryptMessage(msg.data,chatKey)
    })

    const pattern= new RegExp(searchVal,'i')
    const searchMsgs=msgTobeSearch.filter(msg=>pattern.test(msg.data))
    console.log(searchMsgs)
    return res.send({status:200,msg:'Search found success',arr:searchMsgs})
})

module.exports=chatRouter;

   /*
    const searchMsgs=await msgModel.find({ $and:[
        {chatId:{$in:chatIdArr} },{data:{$regex:searchVal,$options:'i'} },{isFileType:false} 
     ] });
    */