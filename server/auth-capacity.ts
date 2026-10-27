/** Limits expensive Argon2 memory use across all servers in this process. */
export class AuthCapacityError extends Error {
  constructor() {super('Authentication is busy. Try again shortly.');this.name='AuthCapacityError';}
}
export class AuthCapacity {
  private active=0;
  constructor(private readonly limit=2) {
    if(!Number.isInteger(limit)||limit<1||limit>4)throw new Error('Authentication capacity must be from 1 to 4.');
  }
  async run<T>(operation:()=>T|Promise<T>):Promise<T> {
    if(this.active>=this.limit)throw new AuthCapacityError();
    this.active++;
    try{return await operation();}finally{this.active--;}
  }
}
// Two 64-MiB hashes leave room for the runtime on the smallest supported host.
export const authCapacity=new AuthCapacity(2);
