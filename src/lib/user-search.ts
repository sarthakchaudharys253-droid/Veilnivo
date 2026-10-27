export interface UserSearchResult {
 id:string;
 username:string;
 relationship:'self'|'none'|'incoming'|'outgoing'|'accepted';
}

export function normalizeSearchUsername(value:string):string {
 const username=value.trim().replace(/^@/,'').toLowerCase();
 if(!/^[a-z0-9_]{3,24}$/.test(username))throw new Error('Enter the full username: 3–24 letters, numbers, or underscores.');
 return username;
}

/** Keep the search surface minimal even if a server accidentally returns extra fields. */
export function parseUserSearchResponse(value:unknown):UserSearchResult[] {
 if(!value||typeof value!=='object'||!Array.isArray((value as {users?:unknown}).users))throw new Error('The backend returned an invalid search response. Try again.');
 const users=(value as {users:unknown[]}).users;
 if(users.length>1)throw new Error('The backend returned an invalid exact-match search response.');
 return users.map(item=>{
  if(!item||typeof item!=='object')throw new Error('The backend returned an invalid user result.');
  const user=item as Record<string,unknown>;
  if(typeof user.id!=='string'||!user.id||typeof user.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(user.username)||!['self','none','incoming','outgoing','accepted'].includes(String(user.relationship)))throw new Error('The backend returned an invalid user result.');
  return {id:user.id,username:user.username,relationship:user.relationship as UserSearchResult['relationship']};
 });
}
