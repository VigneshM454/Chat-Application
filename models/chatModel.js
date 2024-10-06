const mongoose=require('mongoose');

const chatSchema= new mongoose.Schema({
    participants:[{
         type:mongoose.Schema.Types.ObjectId,
         required:true,
         ref:'users'
        }],
    createdAt:{
        type:Date,
        default:new Date(),
    },
    chatKey:{
        type:String,
        required:true,
    },
    lastMsg:{
        type:Object,
        required:true,
        default:{}
    },
    mute:{
        type:[mongoose.Schema.Types.ObjectId],
        default:[],
    },
    block:{
        type:[mongoose.Schema.Types.ObjectId],
        default:[],
    }
},{timestamps:true})

chatSchema.pre('save',(next)=>{
    this.updatedAt=Date.now;
    next();
})

const chatModel=mongoose.model('chat',chatSchema,'chats');

module.exports=chatModel;

/*
lastMsgType:{
        type:Boolean,
        default:false
    },
*/
/*
    lastMsg:{
        type:Map,
        of:new mongoose.Schema({
            data:String,
            isFileType:Boolean,
            date:Date
        }),
        required:true,
        default:{}
    },

*/