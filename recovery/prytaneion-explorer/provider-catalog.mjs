const string={type:'string',minLength:1,maxLength:300};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const read=(name,description,inputSchema=schema())=>({name,description,inputSchema,annotations:{readOnlyHint:true,destructiveHint:false}});
export const PROVIDER_TOOLS={
 github:[read('github_status','Verify existing GitHub credential without returning private account data.'),read('github_repo','Read GitHub repository metadata.',schema({repo:string},['repo'])),read('github_file','Read GitHub repository file (base64, at most 100 KB).',schema({repo:string,path:string,ref:string},['repo','path']))],
 cloudflare:[read('cloudflare_status','Verify existing Cloudflare credential without returning the token.'),read('cloudflare_workers','List Workers in the configured account.'),read('cloudflare_worker','Read deployments of one Worker.',schema({script:string},['script']))],
 notion:[read('notion_status','Verify existing Notion integration credential.'),read('notion_search','Search titles shared with the Notion integration.',schema({query:{type:'string',maxLength:200},start_cursor:string,page_size:{type:'integer',minimum:1,maximum:100}})),read('notion_page','Read one shared Notion page.',schema({page_id:string},['page_id'])),read('notion_children','Read a page or block children, one bounded page at a time.',schema({block_id:string,start_cursor:string,page_size:{type:'integer',minimum:1,maximum:100}},['block_id']))],
 google:[read('google_status','Verify existing Drive credential without returning private file data.')]
};
