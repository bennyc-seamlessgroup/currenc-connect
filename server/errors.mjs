export class PlatformError extends Error {
  constructor(message,status=422,code){super(message);this.status=status;this.code=code;}
}
export const requireValue=(condition,message,status=422)=>{if(!condition)throw new PlatformError(message,status);};
