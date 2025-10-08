import { createServer } from 'graphql-yoga';
import { createSchema } from './schema';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const schema = createSchema();
  const server = createServer({
    schema,
    cors: {
      origin: 'https://web-gmiw.onrender.com/', // Allow all origins
    },
    port: Number(process.env.PORT || 4000),
    context: ({ request }) => ({ headers: request.headers }),
  });

  server.start().then(() =>
    console.log(`✅ GraphQL server running on http://localhost:${process.env.PORT || 4000}`)
  );
}

main();

// import { createServer } from 'graphql-yoga';
// import { createSchema } from './schema';
// import dotenv from 'dotenv';
// dotenv.config();

// async function main(){
//   const schema = createSchema();
//   const server = createServer({
//     schema,
//     port: Number(process.env.PORT || 4000),
//     context: ({ request }) => ({ headers: request.headers })
//   });
//   server.start().then(()=>console.log('GraphQL server running on http://localhost:' + (process.env.PORT || 4000)));
// }
// main();
