const express=require('express');
const jwt=require('jsonwebtoken')
const userModel=require('../models/userModel')
const {hashPassword,comparePassword}=require('../utils/securePassword')
const userRouter=express.Router();
const {verifyToken} =require('../auth/userAuth')
const {sendOtp}=require('../utils/mail');
const deleteImage = require('../utils/handleDeleteImage');
const chatModel = require('../models/chatModel');
const MsgModel = require('../models/messageModel');
const socketIO=require('../socket')
const io=socketIO.getIO()

function generateOtp(){
    var otp= Math.floor(100000+Math.random()*900000).toString();
    console.log(otp);
    return otp;
}

function generateToken(res,userData,message){
    const accessToken=jwt.sign({email:userData.email},process.env.ACCESS_SECRET,{expiresIn:'1m'});
    const refreshToken=jwt.sign({email:userData.email},process.env.REFRESH_SECRET,{expiresIn:'5m'})

    res.cookie('accessToken',accessToken,{
        maxAge:'60000',httpOnly:true,sameSite:'none',secure:true
    })
    res.cookie('refreshToken',refreshToken,{
        maxAge:'300000',httpOnly:true,sameSite:'none',secure:true
    })
    return res.send({status:200,msg:message,data:userData})

}

userRouter.get('/get-userData',verifyToken,async(req,res,next)=>{
   // console.log('entered get-userData')
    const email=req.email;
   // console.log(email)
    const userData=await userModel.findOne({email:email},{passwd:0})
    res.send({status:200,msg:'success',data:userData})
})

userRouter.get('/get-userList',verifyToken,async(req,res,next)=>{
   // console.log('entered get-userlist');
   // console.log(req.email)
    const userList=await userModel.find({},{passwd:0}).lean();
    //here not just userDetails enough but also need to find all chats with that user's _id and the requested user's _id
    const reqUserId=userList.filter((user)=>user.email===req.email)[0]._id
   // console.log(reqUserId)
    const chatInfo=await chatModel.find({
        participants:{'$all': [reqUserId] },
    })
   // console.log(chatInfo)
    //userList.filter(user=>user._id!==reqUserId)
   // console.log(Array.isArray(userList))
    
    
    userList.forEach((users)=>{
        if(users._id===reqUserId){
            let myMsg=chatInfo.filter(chat=>chat.participants.length===1)[0]
            users.lastMsg=(myMsg?.lastMsg.get(reqUserId.toString()))??{}//:myMsg//?.lastMsg[reqUserId.toString()] //(myMsg?.lastMsg[reqUserId.toString()])===undefined?[]:myMsg?.lastMsg[reqUserId.toString()]
           // users.lastMsgType=myMsg?.lastMsgType
            users.mute=myMsg?.mute??[]
            users.block=myMsg?.block??[]
            users.chatId=myMsg?._id
        }else{
            chatInfo.forEach( chats=>{
                if(chats.participants.includes(users._id)){
                    users.lastMsg=(chats?.lastMsg.get(reqUserId.toString()))??{}
                    //users.lastMsgType=chats?.lastMsgType
                    users.mute=chats?.mute??[]
                    users.block=chats?.block??[]
                    users.chatId=chats._id
                    console.log(users)
                }
            })
        }
    })
    res.send({status:200,msg:'success',arr:userList})
})

userRouter.post('/create-account',async(req,res,next)=>{
    console.log(req.body);
    const {fname,lname,email,passwd}=req.body;
    if(fname===''||lname===''||email===''||passwd==='')
        return res.send({status:400,msg:'Some input fields are missing'});
    const user=await userModel.findOne({email:email,passwd:{$ne:''}});
    console.log(user);
    if(user!==null) return res.send({status:300,msg:'An account with similar email exist'});
    //if user is valid
    console.log(passwd);
    const passwd2=hashPassword(passwd)
    const otp=generateOtp();
    const hashOtp=hashPassword(otp)
    //send otp in email
    const mailInfo=await sendOtp({fname,lname,email,otp:otp})
    if(mailInfo!=='Success')return res.send({status:300,msg:'Failed to send otp, some issues in server'})
    const otpToken=jwt.sign({otp:hashOtp,user:{fname,lname,email,passwd:passwd2}},process.env.OTP_SECRET,{expiresIn:'5m'})
    res.cookie('otpToken',otpToken,{
        httpOnly:true,maxAge:'300000',sameSite:'none',secure:true
    })
    res.send({status:200,msg:'Otp send successfully'})
})

userRouter.post('/verify-otp',async(req,res,next)=>{ 
console.log('entred verify otp')
   // const {otpToken}=req.cookies;
   //console.log(req.cookies);
    const {otpval}=req.body;
    if(!otpval)return res.send({status:300,msg:'Please enter otp value'})
    if(req.cookies.otpToken===null)return res.send({status:404,msg:'Session expired,please try again'});
    const otpToken=req.cookies.otpToken
   // console.log(otpToken);
    let user={}
    let otpHash=''
    jwt.verify(otpToken,process.env.OTP_SECRET,(err,decoded)=>{
    //    console.log(err);
     //   console.log(decoded);
        if(err)return res.send({status:400,msg:'invalid token received'})
        user=decoded.user    
        otpHash=decoded.otp
    })
    if(otpHash!=''){
     //   console.log(user)
     //   console.log(otpHash)
        if(!comparePassword(otpval,otpHash))return res.send({status:404,msg:'Invalid  otp ,please enter correct otp'})
        res.clearCookie('otpToken');//the below code should be changed as for old user we need to update
        const isUserExist=await userModel.findOne({email:user.email,passwd:''})
        console.log(isUserExist)
        if(isUserExist===null){
            await userModel.create({...user,profile:'',createdAt:new Date()})
            .then(userDetails=>{
                userDetails.passwd=undefined
                userDetails.lastMsg={}
                io.emit('broadcast',{data:userDetails,action:'create'})
                generateToken(res,userDetails,'Account created successfully')    
            })
        }else{
            await userModel.findOneAndUpdate({email:user.email},{fname:user.fname,lname:user.lname,passwd:user.passwd},{new:true})
            .then(userDetails=>{
                userDetails.passwd=undefined
                userDetails.lastMsg={}
                io.emit('broadcast',{data:userDetails,action:'update'})
                generateToken(res,userDetails,'Account created successfully')    
            })
        }
    }
})

userRouter.post('/login',async(req,res,next)=>{
    console.log('entered login');
    console.log(req.body)
    const {email,passwd}=req.body;
    if(email===''||passwd==='')return res.send({status:400,msg:'Some field are empty'});
    const userData=await userModel.findOne({email:email});
    //console.log(userData)
    if(userData===null)return res.send({status:404,msg:'No such user exist'})
    if(!comparePassword(passwd,userData.passwd)) return res.send({status:404,msg:'Invalid credentials'});
    delete userData.passwd;
    userData.passwd=undefined
    console.log('after deleing userData')
    console.log(userData)
    generateToken(res,userData,'Login success');
})

    //here i need to emit a broadcast event to all, where all client should be able to get it
    //when userChanges his profile =>set/delete,  updates Info --completed
    //similarly when new user joins/creates an account and also for delete Account

userRouter.post('/set-profile-pic',verifyToken,async(req,res,next)=>{
    //logic to insert profile url while deleting the previous url from firebase
    const {userId,oldProfile,newProfile}=req.body;
    console.log(req.body)
    if(userId===""||oldProfile===undefined||newProfile==="")return res.send({status:404,msg:'some credentials are missing'})
    if(oldProfile!==""){//need to delete old profile img
        const firebaseLogs=await deleteImage(oldProfile)
        console.log('is image deleted successfully')
        console.log(firebaseLogs)
    }
    const userDetails=await userModel.findByIdAndUpdate(userId,{
        profile:newProfile},{new:true}
    )
    userDetails.passwd=undefined
    console.log(userDetails)
    io.emit('broadcast',{data:userDetails,action:'update'} )
    return res.send({status:200,msg:'Profile updated successfully',data:userDetails})
})

userRouter.post('/delete-profile',verifyToken,async(req,res,next)=>{
    const {userId,oldProfile}=req.body;
    if(userId==='' || oldProfile==='')return res.send({status:400,msg:'Invalid credentials'})
    const firebaseLogs=await deleteImage(oldProfile)
    console.log(firebaseLogs)
    const userDetails=await userModel.findByIdAndUpdate(userId,{
        profile:""},{new:true})

    userDetails.passwd=undefined
    console.log(userDetails)
    io.emit('broadcast',{data:userDetails,action:'update'})

    return res.send({status:200,msg:'Profile image deleted successfully',data:userDetails})
})

userRouter.post('/edit-profile',verifyToken,async(req,res,next)=>{
    console.log('in /edit-profile');
    console.log(req.body);
    const {fname,lname,email,passwd}=req.body;
    if(fname===''||lname===''||email===''||passwd==='') return res.send({status:400,msg:'Some input fields are missing'})
    const passwd2=hashPassword(passwd)
    console.log(passwd2);
    try{
        await userModel.findOneAndUpdate({email:email},{$set:{
            fname,lname,passwd:passwd2
        }},{new:true} ).then(userDetails=>{
            delete userDetails.passwd;
            userDetails.passwd=undefined
            console.log(userDetails)
            io.emit('broadcast',{data:userDetails,action:'update'})
            return res.send({status:200,msg:'Profile info updated successfully!',data:userDetails})         
        }).catch(err=>{
            console.log('some error occured')
        })
        //const userDetails=await userModel.findOne({email:email})
    }catch(err){
        console.log(err);
        return res.send({status:300,msg:err})
    }
})


userRouter.post('/logout',verifyToken,(req,res,next)=>{
    delete req.email;
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken')
    return res.send({status:200,msg:'Logout success'});
})
//here we should not delete the entire account
//delete user's fname,lname,passwd, profile, his own chats
//get the chatId where participants arr len is 1 and only contains that userId 
//delete all msg where chatyId matches
//that is update fname, lname passwd,profile to ''
//keep _id,email and try to update the userDetails if user again tries to create an account

userRouter.post('/delete-account',verifyToken,async(req,res,next)=>{
    const email=req.email;
    delete req.email;
    const userInfo=await userModel.findOneAndUpdate({email},{
        fname:'',lname:'',passwd:'',profile:''
    },{new:true})//get chatId with help of userId
    if(userInfo.profile!==''){
        const deleteInfo=await deleteImage(userInfo.profile)
        console.log('deleteInfo is '+deleteInfo)
    }
    console.log(userInfo)
    const chats=await chatModel.findOneAndDelete({
        participants:{$eq:[userInfo._id]}
    })
    console.log(chats)
    if(chats && chats._id){
        const deleteOwnMsgs=await MsgModel.deleteMany({chatId:chats._id})
        console.log(deleteOwnMsgs)
    }    
    console.log(userInfo);
    if(userInfo===null) return res.send({status:404, msg:'no such user exist'})
    res.clearCookie('accessToken')
    res.clearCookie('refreshToken')
    userInfo.passwd=undefined
    io.emit('broadcast',{data:userInfo,action:'update'})
    res.send({status:200,msg:'Account deleted successfully'})
})


module.exports=userRouter;