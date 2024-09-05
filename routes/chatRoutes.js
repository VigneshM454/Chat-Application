const express=require('express')
//const userModel=require('../models/userModel')
const chatModel=require('../models/chatModel')
const msgModel=require('../models/messageModel')
//const {socketMap,socket}=require('../app')
const chatRouter=express.Router();
const {verifyToken}=require('../auth/userAuth')
//const deleteImage=require('../utils/handleDeleteImage')
const hideOrDeleteMsg=require('../utils/hideOrDeleteMsg')
const socketIO=require('../socket')
//const socket=socketIO.getSocket()
//const io=socketIO.getIO()
//console.log(socket.rooms)
//socket.emit('demo','viki')

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
    const updateChat=await chatModel.findOneAndUpdate({_id:chatId},{[`lastMsg.${userId}`]:{}},{new:true})
    const io=socketIO.getIO()
    console.log('updateChat.lastMsg')
    console.log(updateChat.lastMsg)
    //sendUpdate({TO:userId,msg:'',sender:userId,recvr:recvr,lastMsgType:false}) //this is ok for only one user, incase of 2 the recever is dan
    io.to(userId).emit('recvNotify',{isNotify:false,sender:userId,recvr:recvr,lastMsg:{empty:""}})

    console.log('hideOrDeleteLogs :'+hideOrDeleteLogs)
    hideOrDeleteLogs ? res.send({status:200,msg:'Chat cleared successfully !'})
        :res.send({status:300,msg:'Some errors occured in clearing the chats'})
})

chatRouter.post('/mute_user',verifyToken,async(req,res,next)=>{
    console.log('entered mute/unmute nofify')
    console.log(req.body)
    const {userId,chatId,action}=req.body;
    if(userId===undefined||chatId===undefined)return res.send({status:400,msg:'Invalid access '})
    let pushOrPull= action==='mute'? '$push' : '$pull'

    const updatedChat=await chatModel.findByIdAndUpdate({_id:chatId},{[pushOrPull]:
        {mute:userId} 
    },{new:true})
    console.log(updatedChat)
    res.send({status:200,msg:action==='mute'?'Mutted successfully':"Unmutted successfully",data:updatedChat})
})

chatRouter.post('/search_msg',verifyToken,async(req,res,next)=>{
    console.log('inside search msg')
    const {searchVal,chatIdArr}=req.body;
    console.log(req.body)
    if(searchVal===''||chatIdArr.length<1) return res.send({status:400,msg:'Some Fields are missing'})
    const searchMsgs=await msgModel.find({ $and:[
        {chatId:{$in:chatIdArr} },{data:{$regex:searchVal,$options:'i'} },{isFileType:false} 
     ] });
    console.log(searchMsgs)
    return res.send({status:200,msg:'Search found success',arr:searchMsgs})
})

module.exports=chatRouter;