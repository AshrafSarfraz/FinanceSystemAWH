1- Dolphin Login and fix accoridng to type P and accountname and company name  
   
                . src/performanceReport/dolphin/ww_Api

http://localhost:3000/api/trialbalance           get raw Data from Api(Post method)
http://localhost:3000/api/trialbalance/sync      get and push mapped data in mongoDb  (Post method)
http://localhost:3000/api/trialbalance/mongo          get the monthly wise data after merging   (get method)

-----------------------------------------------------------------------

http://localhost:3000/api/othercmp_trialbalance 
http://localhost:3000/api/othercmp_trialbalance/sync       get data from Database Sql   (Get Method)
http://localhost:3000/api/othercmp_trialbalance/mongo






http://localhost:3000/api/budgted