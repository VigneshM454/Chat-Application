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

const {decrypt,ENCRYPTION_KEY,decryptMessage}=require('../encryptDemo')


function generateOtp(){
    var otp= Math.floor(100000+Math.random()*900000).toString();
    //console.log(otp);
    return otp;
}

function generateToken(res,userData,message){
    const accessToken=jwt.sign({email:userData.email},process.env.ACCESS_SECRET,{expiresIn:'15m'});
    const refreshToken=jwt.sign({email:userData.email},process.env.REFRESH_SECRET,{expiresIn:'2d'})

    res.cookie('accessToken',accessToken,{
        maxAge:15 * 60 * 1000,httpOnly:true,sameSite:'none',secure:true
    })
    res.cookie('refreshToken',refreshToken,{
        maxAge:2 * 24 * 60 * 60 * 1000,httpOnly:true,sameSite:'none',secure:true
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
   // console.log('entered get-userlist');// console.log(req.email)
    const userList=await userModel.find({},{passwd:0}).lean();
    //here not just userDetails enough but also need to find all chats with that user's _id and the requested user's _id
    const reqUserId=userList.filter((user)=>user.email===req.email)[0]._id
   //see here the new users wont hav any chat
    const chatInfo=await chatModel.find({
        participants:{'$all': [reqUserId] },
    })
    //console.log('chatInfo.length'+chatInfo.length)    
    const userList2=[]
    
    for(let users of userList){
        let dontShow=false
        if(users._id===reqUserId){
            let myMsg=chatInfo.filter(chat=>chat.participants.length===1)[0]
            let encMsg=myMsg?.lastMsg[(users._id).toString()]
            //console.log(myMsg)
            //console.log(encMsg)
            if(encMsg ){
                let msgData=await MsgModel.findOne({_id:encMsg})//getting the lastMsg
                //console.log(msgData)
                const chatKey=decrypt(myMsg.chatKey,ENCRYPTION_KEY)
                users.lastMsg={data:decryptMessage((msgData.data),chatKey), date:msgData.createdAt,isFileType:msgData.isFileType}; 
            }else users.lastMsg={}

            users.mute=myMsg?.mute??[]
            users.block=myMsg?.block??[]
            users.chatId=myMsg?._id
            await userList2.push(users)
        }else{//this should be changed
            if(users.isDeleted){//if user is deleted, check whether there exist any chat between them, and if then check whether there are msg in those chats
                dontShow=true
                const DelUserChat=await chatModel.findOne({participants:{'$all':[users._id,reqUserId]}})
                //console.log(DelUserChat?'-------user exist --------------------':'------- no such user----------')
                //console.log('Del user chat')
                //console.log(DelUserChat)
                if(DelUserChat && DelUserChat._id){//now check whether any msg exist if not delete it
                    //console.log('del userr chat exist')
                    const msgs=await MsgModel.find({chatId:DelUserChat._id})
                    //if any msg exist then show user
                    msgs.length==0 ? (await chatModel.deleteOne({_id:DelUserChat._id}) ,users=null): (dontShow=false,console.log('********** set dont show to false *********'))
                }
            }

            if(!dontShow){
                let specificChat=chatInfo.filter(c=>c.participants.includes(users._id) && !dontShow)[0]
                //console.log('specific chat')
                if(specificChat){
                    let encMsg=specificChat.lastMsg[(users._id).toString()]              
                    if(encMsg){
                        let msgData=await MsgModel.findOne({_id:encMsg})//getting the lastMsg
                        const chatKey=decrypt(specificChat.chatKey,ENCRYPTION_KEY)
                        users.lastMsg={data:decryptMessage(msgData.data,chatKey), date:msgData.createdAt,isFileType:msgData.isFileType};
                    }else users.lastMsg={};
                    users.mute=specificChat?.mute??[]
                    users.block=specificChat?.block??[]
                    users.chatId=specificChat._id
                    //console.log(users)
                }
                await userList2.push(users)
            }
            
        }
    }

    ////console.log('userList2 which is to be sent is ')
    ////console.log(userList2)
    res.send({status:200,msg:'success',arr:userList2})
})

userRouter.post('/create-account',async(req,res,next)=>{
    //console.log(req.body);
    const {fname,lname,email,passwd}=req.body;
    if(fname===''||lname===''||email===''||passwd==='')
        return res.send({status:400,msg:'Some input fields are missing'});
    const user=await userModel.findOne({email:email,passwd:{$ne:''}});
    //console.log(user);
    if(user!==null) return res.send({status:300,msg:'An account with similar email exist'});
    //if user is valid
    //console.log(passwd);
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
//console.log('entred verify otp')
   // const {otpToken}=req.cookies;
   ////console.log(req.cookies);
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
        //console.log(isUserExist)
        if(isUserExist===null){
            await userModel.create({...user,profile:'',createdAt:new Date()})
            .then(userDetails=>{
                userDetails.passwd=undefined
                userDetails.lastMsg={}
                io.emit('broadcast',{data:userDetails,action:'create'})
                generateToken(res,userDetails,'Account created successfully')    
            })
        }else{
            await userModel.findOneAndUpdate({email:user.email},{fname:user.fname,lname:user.lname,passwd:user.passwd,isDeleted:false},{new:true})
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
    //console.log('entered login');
    //console.log(req.body)
    const {email,passwd}=req.body;
    if(email===''||passwd==='')return res.send({status:400,msg:'Some field are empty'});
    const userData=await userModel.findOne({email:email});
    //console.log(userData)
    if(userData===null)return res.send({status:404,msg:'No such user exist'})
    if(!comparePassword(passwd,userData.passwd)) return res.send({status:404,msg:userData.isDeleted? 'To restore your account, just create an account with same email':'Invalid credentials'});
    delete userData.passwd;
    userData.passwd=undefined
    //console.log('after deleing userData')
    //console.log(userData)
    generateToken(res,userData,'Login success');
})

    //here i need to emit a broadcast event to all, where all client should be able to get it
    //when userChanges his profile =>set/delete,  updates Info --completed
    //similarly when new user joins/creates an account and also for delete Account

userRouter.post('/set-profile-pic',verifyToken,async(req,res,next)=>{
    //logic to insert profile url while deleting the previous url from firebase
    const {userId,oldProfile,newProfile}=req.body;
    //console.log(req.body)
    if(userId===""||oldProfile===undefined||newProfile==="")return res.send({status:404,msg:'some credentials are missing'})
    if(oldProfile!==""){//need to delete old profile img
        const firebaseLogs=await deleteImage(oldProfile)
        //console.log('is image deleted successfully')
        //console.log(firebaseLogs)
    }
    const userDetails=await userModel.findByIdAndUpdate(userId,{
        profile:newProfile},{new:true}
    )
    userDetails.passwd=undefined
    //console.log(userDetails)
    io.emit('broadcast',{data:userDetails,action:'update'} )
    return res.send({status:200,msg:'Profile updated successfully',data:userDetails})
})

userRouter.post('/delete-profile',verifyToken,async(req,res,next)=>{
    const {userId,oldProfile}=req.body;
    if(userId==='' || oldProfile==='')return res.send({status:400,msg:'Invalid credentials'})
    const firebaseLogs=await deleteImage(oldProfile)
    //console.log(firebaseLogs)
    const userDetails=await userModel.findByIdAndUpdate(userId,{
        profile:""},{new:true})

    userDetails.passwd=undefined
    //console.log(userDetails)
    io.emit('broadcast',{data:userDetails,action:'update'})

    return res.send({status:200,msg:'Profile image deleted successfully',data:userDetails})
})

userRouter.post('/edit-profile',verifyToken,async(req,res,next)=>{
    //console.log(req.body);
    const {fname,lname,email,passwd}=req.body;
    if(fname===''||lname===''||email===''||passwd==='') return res.send({status:400,msg:'Some input fields are missing'})
    const passwd2=hashPassword(passwd)
    //console.log(passwd2);
    try{
        await userModel.findOneAndUpdate({email:email},{$set:{
            fname,lname,passwd:passwd2
        }},{new:true} ).then(userDetails=>{
            delete userDetails.passwd;
            userDetails.passwd=undefined
            //console.log(userDetails)
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

userRouter.post('/delete-account',verifyToken,async(req,res,next)=>{
    const email=req.email;
    delete req.email;
    const userInfo=await userModel.findOneAndUpdate({email},{
        fname:'',lname:'',passwd:'',profile:'',isDeleted:true
    },{new:true})//get chatId with help of userId
    if(userInfo.profile!==''){
        const deleteInfo=await deleteImage(userInfo.profile)
        //console.log('deleteInfo is '+deleteInfo)
    }
    //console.log(userInfo)//below we also need to delete the chat with this deleted user which has no msg
    //also we only need to display this deleted user in userList page if and only if the deleted user has any msg
    //if no just completely delte user
    const chats=await chatModel.findOneAndDelete({
        participants:{$eq:[userInfo._id]}
    })
    //console.log(chats)
    if(chats && chats._id){
        await MsgModel.deleteMany({chatId:chats._id})
    }    
    //console.log(userInfo);
    if(userInfo===null) return res.send({status:404, msg:'no such user exist'})
    res.clearCookie('accessToken')
    res.clearCookie('refreshToken')
    userInfo.passwd=undefined
    io.emit('broadcast',{data:userInfo,action:'update'})
    res.send({status:200,msg:'Account deleted successfully'})
})

module.exports=userRouter;

//here we should not delete the entire account
//delete user's fname,lname,passwd, profile, his own chats
//get the chatId where participants arr len is 1 and only contains that userId 
//delete all msg where chatyId matches
//that is update fname, lname passwd,profile to ''
//keep _id,email and try to update the userDetails if user again tries to create an account
