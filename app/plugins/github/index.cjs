const { execFile } = require('node:child_process');
module.exports = async function ({ PluginError, run = execFile }) {
  let disposed = false;
  const children = new Set();
  function read(endpoint) {
    if (disposed) throw new PluginError('Enable GitHub first.',403);
    return new Promise((resolve,reject) => {
      let child;
      child = run('gh', ['api', '--method', 'GET', endpoint], { windowsHide:true, timeout:20000, maxBuffer:1024*1024, encoding:'utf8' }, (error, stdout) => {
        children.delete(child);
        if (error) return reject(new PluginError('GitHub could not be read. Check this PC’s GitHub CLI sign-in with gh auth login, then retry.',502));
        try { resolve(JSON.parse(stdout)); } catch { reject(new PluginError('GitHub returned an unreadable response. Retry.',502)); }
      });
      if (child) children.add(child);
    });
  }
  function repoName(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.length > 220 || value.split('/').some(p=>p==='.'||p==='..')) throw new PluginError('Choose a valid owner/repository.');
    return value.split('/').map(encodeURIComponent).join('/');
  }
  function event(e) {
    const labels={PushEvent:'Pushed commits',PullRequestEvent:'Pull request',IssuesEvent:'Issue',IssueCommentEvent:'Comment',CreateEvent:'Created '+(e.payload?.ref_type||'ref'),DeleteEvent:'Deleted ref',ReleaseEvent:'Release',WatchEvent:'Starred',ForkEvent:'Forked'};
    return { type:e.type, title:labels[e.type]||e.type.replace(/Event$/,''), actor:e.actor?.login||'', at:e.created_at,
      detail:e.payload?.pull_request?.title||e.payload?.issue?.title||e.payload?.release?.name||e.payload?.commits?.[0]?.message?.split('\n')[0]||e.payload?.ref||'',
      url:e.payload?.pull_request?.html_url||e.payload?.issue?.html_url||e.payload?.release?.html_url||'' };
  }
  return {
    status: async () => ({ state:'ready',detail:'Uses this PC’s GitHub CLI account. Read access is checked when loading repositories.' }),
    actions: {
      repositories: async ({limit=5}={}) => {
        if(!Number.isInteger(limit)||limit<1||limit>10) throw new PluginError('Repository limit must be between 1 and 10.');
        const result = await read('/user/repos?sort=updated&per_page=20&type=all');
        if (!Array.isArray(result)) throw new PluginError('GitHub returned an unexpected repository list.',502);
        const repositories=result.slice(0,limit).map(r=>({name:r.full_name,url:r.html_url,description:r.description,private:Boolean(r.private),updatedAt:r.updated_at,pushedAt:r.pushed_at}));
        for(let i=0;i<repositories.length;i+=3) await Promise.all(repositories.slice(i,i+3).map(async r=>{
          try { const events=await read('/repos/'+repoName(r.name)+'/events?per_page=1');r.lastActivity=events[0]?event(events[0]):null; } catch { r.activityUnavailable=true; }
        }));
        return {repositories};
      },
      repository: async ({repo}={}) => {
        const name=repoName(repo);
        const [info,events,commits,pulls]=await Promise.all([
          read('/repos/'+name),read('/repos/'+name+'/events?per_page=10'),
          read('/repos/'+name+'/commits?per_page=5').catch(()=>[]),read('/repos/'+name+'/pulls?state=open&per_page=5').catch(()=>[])
        ]);
        return { description:info.description,defaultBranch:info.default_branch,openIssues:info.open_issues_count,language:info.language,
          events:events.map(event),commits:commits.map(c=>({title:c.commit?.message?.split('\n')[0],at:c.commit?.committer?.date,url:c.html_url})),
          pulls:pulls.map(p=>({title:p.title,url:p.html_url,number:p.number,at:p.updated_at})) };
      }
    },
    dispose: async () => { disposed = true; for (const child of children) child.kill(); children.clear(); }
  };
};
