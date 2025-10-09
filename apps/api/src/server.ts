import { createServer } from 'graphql-yoga';
import { createSchema } from './schema';
import dotenv from 'dotenv';
dotenv.config();

//async function main() {
  const schema = createSchema();

  const server = createServer({
    schema,
    cors: {
      origin: [
      'https://web-gmiw.onrender.com',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'apollo-require-preflight',
      'x-user-id'
    ]
    //  allowedHeaders: ['Content-Type', 'x-user-id', 'Authorization'],
    //  credentials: true,
    },
    port: Number(process.env.PORT || 4000),
    context: ({ request }) => ({ headers: request.headers }),
  });

  server.start().then(() =>
    console.log(`🚀 GraphQL server running on port ${process.env.PORT || 4000}`)
  );
//}

//main();


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
